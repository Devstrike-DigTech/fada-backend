import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppContent,
  GoodCauseProject,
  GoodCauseTestimonial,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { RedisService } from '@infra/redis/redis.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { CloudinaryService } from '@infra/storage/cloudinary.service';
import { EVENTS } from '@common/types/events.types';
import {
  CONTENT_DEFAULTS,
  CONTENT_KEYS,
  ContentKey,
  SLUG_TO_KEY,
} from './content.defaults';
import {
  CreateProjectDto,
  CreateTestimonialDto,
  UpdateContentDto,
  UpdateProjectDto,
  UpdateTestimonialDto,
} from './dto/content.dto';

const PAGE_TTL_SECS = 600;
const GOOD_CAUSE_TTL_SECS = 300;
const cacheKey = (key: string) => `content:page:${key}`;
const GOOD_CAUSE_CACHE = 'content:good-cause';

/**
 * Back-office-editable pages and the Good Cause section. Public reads are
 * cached in Redis and fall back to the generated defaults, so the apps work
 * before anything is seeded. Edits bump `version` and invalidate the cache.
 */
@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly eventBus: EventBusService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Pages — public
  // ═══════════════════════════════════════════════════════════════════════════

  /** Index the apps use to decide which pages to refetch. */
  async index() {
    const rows = await this.prisma.appContent.findMany({
      where: { isPublished: true },
      select: { key: true, title: true, version: true, updatedAt: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return CONTENT_KEYS.map((key) => {
      const r = byKey.get(key);
      return {
        key,
        slug: Object.entries(SLUG_TO_KEY).find(([, k]) => k === key)?.[0],
        title: r?.title ?? CONTENT_DEFAULTS[key].title,
        version: r?.version ?? 0,
        updatedAt: r?.updatedAt ?? null,
      };
    });
  }

  async getPage(keyOrSlug: string) {
    const key = this.resolveKey(keyOrSlug);
    const cached = await this.safeCacheGet(cacheKey(key));
    if (cached)
      return JSON.parse(cached) as ReturnType<ContentService['presentPage']>;

    const row = await this.prisma.appContent.findUnique({ where: { key } });
    const page =
      row && row.isPublished ? this.presentPage(row) : this.presentDefault(key);
    await this.safeCacheSet(cacheKey(key), JSON.stringify(page), PAGE_TTL_SECS);
    return page;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pages — back office
  // ═══════════════════════════════════════════════════════════════════════════

  async adminListPages() {
    const rows = await this.prisma.appContent.findMany({
      orderBy: { key: 'asc' },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return CONTENT_KEYS.map((key) => {
      const r = byKey.get(key);
      return {
        key,
        title: r?.title ?? CONTENT_DEFAULTS[key].title,
        format: r?.format ?? CONTENT_DEFAULTS[key].format,
        version: r?.version ?? 0,
        isPublished: r?.isPublished ?? true,
        source: r ? 'database' : 'default',
        effectiveDate: r?.effectiveDate ?? null,
        updatedById: r?.updatedById ?? null,
        updatedAt: r?.updatedAt ?? null,
      };
    });
  }

  async adminGetPage(keyOrSlug: string) {
    const key = this.resolveKey(keyOrSlug);
    const row = await this.prisma.appContent.findUnique({ where: { key } });
    return row
      ? {
          ...this.presentPage(row),
          isPublished: row.isPublished,
          updatedById: row.updatedById,
        }
      : { ...this.presentDefault(key), isPublished: true, updatedById: null };
  }

  async adminUpdatePage(
    keyOrSlug: string,
    dto: UpdateContentDto,
    adminUserId: string,
  ) {
    const key = this.resolveKey(keyOrSlug);
    const existing = await this.prisma.appContent.findUnique({
      where: { key },
    });
    const def = CONTENT_DEFAULTS[key];
    const format = dto.format ?? existing?.format ?? def.format;

    let serialised: string | undefined;
    if (dto.content !== undefined) {
      serialised = this.serialise(dto.content, format);
    } else if (!existing) {
      serialised = this.serialise(def.content, def.format);
    }

    const effectiveDate = dto.effectiveDate
      ? new Date(dto.effectiveDate)
      : (existing?.effectiveDate ??
        (def.effectiveDate ? new Date(def.effectiveDate) : undefined));

    const row = existing
      ? await this.prisma.appContent.update({
          where: { key },
          data: {
            title: dto.title,
            content: serialised,
            format,
            isPublished: dto.isPublished,
            effectiveDate,
            version: { increment: 1 },
            updatedById: adminUserId,
          },
        })
      : await this.prisma.appContent.create({
          data: {
            key,
            title: dto.title ?? def.title,
            content: serialised!,
            format,
            isPublished: dto.isPublished ?? true,
            effectiveDate,
            updatedById: adminUserId,
          },
        });

    await this.safeCacheDel(cacheKey(key));
    this.eventBus.emit(EVENTS.CONTENT.UPDATED, {
      key,
      version: row.version,
      adminUserId,
    });
    this.eventBus.emit(EVENTS.ADMIN.ACTION_PERFORMED, {
      adminUserId,
      action: 'content.update',
      targetType: 'app_content',
      targetId: key,
      details: {
        version: row.version,
        format,
        isPublished: row.isPublished,
        titleChanged: !!dto.title,
      },
      occurredAt: new Date(),
    });
    return { ...this.presentPage(row), isPublished: row.isPublished };
  }

  /** Restores the generated default text for a page (new version). */
  async adminResetPage(keyOrSlug: string, adminUserId: string) {
    const key = this.resolveKey(keyOrSlug);
    const def = CONTENT_DEFAULTS[key];
    return this.adminUpdatePage(
      key,
      {
        title: def.title,
        content: def.content,
        format: def.format,
        isPublished: true,
      },
      adminUserId,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Good Cause — public
  // ═══════════════════════════════════════════════════════════════════════════

  async goodCauseOverview() {
    const cached = await this.safeCacheGet(GOOD_CAUSE_CACHE);
    if (cached) return JSON.parse(cached) as unknown;

    const [projects, testimonials] = await Promise.all([
      this.prisma.goodCauseProject.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.goodCauseTestimonial.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);
    const overview = {
      stats: this.stats(projects),
      projects: projects.map((p) => this.presentProject(p)),
      testimonials: testimonials.map((t) => this.presentTestimonial(t)),
    };
    await this.safeCacheSet(
      GOOD_CAUSE_CACHE,
      JSON.stringify(overview),
      GOOD_CAUSE_TTL_SECS,
    );
    return overview;
  }

  async listProjects() {
    const projects = await this.prisma.goodCauseProject.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return projects.map((p) => this.presentProject(p));
  }

  async getProject(id: string) {
    const p = await this.prisma.goodCauseProject.findFirst({
      where: { id, isActive: true },
      include: {
        testimonials: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        },
      },
    });
    if (!p) throw new NotFoundException('Project not found');
    return {
      ...this.presentProject(p),
      testimonials: p.testimonials.map((t) => this.presentTestimonial(t)),
    };
  }

  async listTestimonials(projectId?: string) {
    const rows = await this.prisma.goodCauseTestimonial.findMany({
      where: { isActive: true, ...(projectId ? { projectId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((t) => this.presentTestimonial(t));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Good Cause — back office
  // ═══════════════════════════════════════════════════════════════════════════

  async adminListProjects() {
    const rows = await this.prisma.goodCauseProject.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { testimonials: true } } },
    });
    return rows.map((p) => ({
      ...this.presentProject(p),
      isActive: p.isActive,
      testimonialCount: p._count.testimonials,
    }));
  }

  async adminCreateProject(dto: CreateProjectDto, adminUserId: string) {
    this.assertDates(dto.startDate, dto.endDate);
    const p = await this.prisma.goodCauseProject.create({
      data: this.projectData(dto) as Prisma.GoodCauseProjectCreateInput,
    });
    await this.afterGoodCauseChange(
      adminUserId,
      'good_cause.project.create',
      p.id,
    );
    return { ...this.presentProject(p), isActive: p.isActive };
  }

  async adminUpdateProject(
    id: string,
    dto: UpdateProjectDto,
    adminUserId: string,
  ) {
    const existing = await this.prisma.goodCauseProject.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Project not found');
    this.assertDates(
      dto.startDate ?? existing.startDate?.toISOString(),
      dto.endDate ?? existing.endDate?.toISOString(),
    );
    const p = await this.prisma.goodCauseProject.update({
      where: { id },
      data: this.projectData(dto),
    });
    await this.afterGoodCauseChange(
      adminUserId,
      'good_cause.project.update',
      id,
    );
    return { ...this.presentProject(p), isActive: p.isActive };
  }

  async adminDeleteProject(id: string, adminUserId: string) {
    const p = await this.prisma.goodCauseProject.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Project not found');
    await this.prisma.goodCauseProject.delete({ where: { id } });
    if (p.imageCloudinaryId)
      await this.cloudinary
        .deleteImage(p.imageCloudinaryId)
        .catch(() => undefined);
    await this.afterGoodCauseChange(
      adminUserId,
      'good_cause.project.delete',
      id,
    );
    return { deleted: true };
  }

  async adminUploadProjectImage(
    id: string,
    file: Express.Multer.File,
    adminUserId: string,
  ) {
    if (!file) throw new BadRequestException('No image file provided');
    const p = await this.prisma.goodCauseProject.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Project not found');
    const res = await this.cloudinary.uploadImage(
      file.buffer,
      'good-cause/projects',
    );
    if (p.imageCloudinaryId)
      await this.cloudinary
        .deleteImage(p.imageCloudinaryId)
        .catch(() => undefined);
    const updated = await this.prisma.goodCauseProject.update({
      where: { id },
      data: { imageUrl: res.url, imageCloudinaryId: res.publicId },
    });
    await this.afterGoodCauseChange(
      adminUserId,
      'good_cause.project.image',
      id,
    );
    return { ...this.presentProject(updated), isActive: updated.isActive };
  }

  async adminListTestimonials() {
    const rows = await this.prisma.goodCauseTestimonial.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { project: { select: { id: true, title: true } } },
    });
    return rows.map((t) => ({
      ...this.presentTestimonial(t),
      isActive: t.isActive,
      project: t.project,
    }));
  }

  async adminCreateTestimonial(dto: CreateTestimonialDto, adminUserId: string) {
    if (dto.projectId) await this.assertProject(dto.projectId);
    const t = await this.prisma.goodCauseTestimonial.create({
      data: {
        authorName: dto.authorName.trim(),
        authorLocation: dto.authorLocation,
        content: dto.content.trim(),
        projectId: dto.projectId,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.afterGoodCauseChange(
      adminUserId,
      'good_cause.testimonial.create',
      t.id,
    );
    return { ...this.presentTestimonial(t), isActive: t.isActive };
  }

  async adminUpdateTestimonial(
    id: string,
    dto: UpdateTestimonialDto,
    adminUserId: string,
  ) {
    const existing = await this.prisma.goodCauseTestimonial.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Testimonial not found');
    if (dto.projectId) await this.assertProject(dto.projectId);
    const t = await this.prisma.goodCauseTestimonial.update({
      where: { id },
      data: {
        authorName: dto.authorName?.trim(),
        authorLocation: dto.authorLocation,
        content: dto.content?.trim(),
        projectId: dto.projectId,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
    await this.afterGoodCauseChange(
      adminUserId,
      'good_cause.testimonial.update',
      id,
    );
    return { ...this.presentTestimonial(t), isActive: t.isActive };
  }

  async adminDeleteTestimonial(id: string, adminUserId: string) {
    const t = await this.prisma.goodCauseTestimonial.findUnique({
      where: { id },
    });
    if (!t) throw new NotFoundException('Testimonial not found');
    await this.prisma.goodCauseTestimonial.delete({ where: { id } });
    if (t.avatarCloudinaryId)
      await this.cloudinary
        .deleteImage(t.avatarCloudinaryId)
        .catch(() => undefined);
    await this.afterGoodCauseChange(
      adminUserId,
      'good_cause.testimonial.delete',
      id,
    );
    return { deleted: true };
  }

  async adminUploadTestimonialAvatar(
    id: string,
    file: Express.Multer.File,
    adminUserId: string,
  ) {
    if (!file) throw new BadRequestException('No image file provided');
    const t = await this.prisma.goodCauseTestimonial.findUnique({
      where: { id },
    });
    if (!t) throw new NotFoundException('Testimonial not found');
    const res = await this.cloudinary.uploadImage(
      file.buffer,
      'good-cause/testimonials',
    );
    if (t.avatarCloudinaryId)
      await this.cloudinary
        .deleteImage(t.avatarCloudinaryId)
        .catch(() => undefined);
    const updated = await this.prisma.goodCauseTestimonial.update({
      where: { id },
      data: { authorAvatar: res.url, avatarCloudinaryId: res.publicId },
    });
    await this.afterGoodCauseChange(
      adminUserId,
      'good_cause.testimonial.avatar',
      id,
    );
    return { ...this.presentTestimonial(updated), isActive: updated.isActive };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Internals
  // ═══════════════════════════════════════════════════════════════════════════

  private resolveKey(keyOrSlug: string): ContentKey {
    const key = SLUG_TO_KEY[keyOrSlug] ?? keyOrSlug;
    if (!CONTENT_KEYS.includes(key))
      throw new NotFoundException(`Unknown content page "${keyOrSlug}"`);
    return key;
  }

  private serialise(content: unknown, format: string): string {
    if (format === 'json') {
      if (typeof content === 'string') {
        try {
          JSON.parse(content);
          return content;
        } catch {
          throw new BadRequestException('content is not valid JSON');
        }
      }
      return JSON.stringify(content);
    }
    if (typeof content !== 'string' || content.trim() === '') {
      throw new BadRequestException(
        `content must be a non-empty ${format} string`,
      );
    }
    if (content.length > 200_000)
      throw new BadRequestException('content is too long');
    return content;
  }

  private parse(content: string, format: string): unknown {
    if (format !== 'json') return content;
    try {
      return JSON.parse(content) as unknown;
    } catch {
      this.logger.error(
        'Stored JSON content is not parseable; returning raw string',
      );
      return content;
    }
  }

  private presentPage(row: AppContent) {
    return {
      key: row.key,
      title: row.title,
      format: row.format,
      content: this.parse(row.content, row.format),
      version: row.version,
      effectiveDate: row.effectiveDate,
      updatedAt: row.updatedAt,
      source: 'database' as const,
    };
  }

  private presentDefault(key: ContentKey) {
    const d = CONTENT_DEFAULTS[key];
    return {
      key,
      title: d.title,
      format: d.format,
      content: d.content,
      version: 0,
      effectiveDate: d.effectiveDate ? new Date(d.effectiveDate) : null,
      updatedAt: null,
      source: 'default' as const,
    };
  }

  private stats(projects: GoodCauseProject[]) {
    const states = new Set<string>();
    let beneficiaries = 0;
    let raised = 0;
    for (const p of projects) {
      beneficiaries += p.beneficiaries;
      raised += Number(p.raisedAmountNgn);
      p.states.forEach((s) => states.add(s.trim().toLowerCase()));
    }
    return {
      patientsHelped: beneficiaries,
      donatedNgn: raised,
      statesReached: states.size,
      activeProjects: projects.filter((p) => p.status === 'active').length,
    };
  }

  private presentProject(p: GoodCauseProject) {
    const target =
      p.targetAmountNgn === null ? null : Number(p.targetAmountNgn);
    const raised = Number(p.raisedAmountNgn);
    return {
      id: p.id,
      title: p.title,
      summary: p.summary,
      description: p.description,
      imageUrl: p.imageUrl,
      status: p.status,
      targetAmountNgn: target,
      raisedAmountNgn: raised,
      fundedPercent:
        target && target > 0
          ? Math.min(100, Math.round((raised / target) * 100))
          : null,
      beneficiaries: p.beneficiaries,
      states: p.states,
      startDate: p.startDate,
      endDate: p.endDate,
      sortOrder: p.sortOrder,
      updatedAt: p.updatedAt,
    };
  }

  private presentTestimonial(t: GoodCauseTestimonial) {
    return {
      id: t.id,
      projectId: t.projectId,
      authorName: t.authorName,
      authorLocation: t.authorLocation,
      avatarUrl: t.authorAvatar,
      content: t.content,
      sortOrder: t.sortOrder,
      createdAt: t.createdAt,
    };
  }

  private projectData(
    dto: UpdateProjectDto,
  ): Prisma.GoodCauseProjectUpdateInput {
    return {
      title: dto.title?.trim(),
      summary: dto.summary,
      description: dto.description?.trim(),
      status: dto.status,
      targetAmountNgn: dto.targetAmountNgn,
      raisedAmountNgn: dto.raisedAmountNgn,
      beneficiaries: dto.beneficiaries,
      states: dto.states?.map((s) => s.trim()).filter(Boolean),
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      isActive: dto.isActive,
      sortOrder: dto.sortOrder,
    };
  }

  private assertDates(start?: string, end?: string): void {
    if (start && end && new Date(end) < new Date(start)) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
  }

  private async assertProject(id: string): Promise<void> {
    const p = await this.prisma.goodCauseProject.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!p) throw new BadRequestException('Project not found');
  }

  private async afterGoodCauseChange(
    adminUserId: string,
    action: string,
    targetId: string,
  ) {
    await this.safeCacheDel(GOOD_CAUSE_CACHE);
    this.eventBus.emit(EVENTS.ADMIN.ACTION_PERFORMED, {
      adminUserId,
      action,
      targetType: action.includes('testimonial')
        ? 'good_cause_testimonial'
        : 'good_cause_project',
      targetId,
      occurredAt: new Date(),
    });
  }

  // Redis is an optimisation: a cache outage must never break content pages
  private async safeCacheGet(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  private async safeCacheSet(
    key: string,
    value: string,
    ttl: number,
  ): Promise<void> {
    try {
      await this.redis.set(key, value, ttl);
    } catch {
      /* ignore */
    }
  }

  private async safeCacheDel(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      /* ignore */
    }
  }
}
