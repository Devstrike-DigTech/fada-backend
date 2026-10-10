import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import {
  addDays,
  dayRange,
  lagosDay,
  resolvePeriod,
} from '@modules/analytics/analytics-dates';
import {
  INTERACTION_FUTURE_TOLERANCE_MS,
  normalizePhone,
} from './marketing.constants';
import {
  AdminProspectQueryDto,
  CreateProspectDto,
  CreateSalesRouteDto,
  LogInteractionDto,
  MarketingSummaryQueryDto,
  ProspectQueryDto,
  UpdateProspectDto,
  UpdateSalesRouteDto,
} from './dto/marketing.dto';

const PERSON = { select: { id: true, firstName: true, lastName: true } };

const PROSPECT_INCLUDE = {
  route: { select: { id: true, name: true } },
  addedBy: PERSON,
  deletedBy: PERSON,
  convertedPharmacy: { select: { id: true, name: true } },
} satisfies Prisma.PharmacyProspectInclude;

type ProspectRow = Prisma.PharmacyProspectGetPayload<{
  include: typeof PROSPECT_INCLUDE;
}>;

type InteractionRow = Prisma.ProspectInteractionGetPayload<{
  include: { marketer: typeof PERSON };
}>;

type Person = { id: string; firstName: string | null; lastName: string | null };

export type InteractionKind = 'call' | 'visit';

@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Routes ──────────────────────────────────────────────────────────────────

  async listRoutes(includeInactive = false) {
    const routes = await this.prisma.salesRoute.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (!includeInactive) {
      return routes.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
      }));
    }
    const counts = await this.prisma.pharmacyProspect.groupBy({
      by: ['routeId'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const byRoute = new Map(counts.map((c) => [c.routeId, c._count._all]));
    return routes.map((r) => ({
      ...r,
      prospectCount: byRoute.get(r.id) ?? 0,
    }));
  }

  async createRoute(dto: CreateSalesRouteDto) {
    await this.assertRouteNameFree(dto.name);
    return this.prisma.salesRoute.create({
      data: {
        name: dto.name,
        description: dto.description,
        sortOrder: dto.sortOrder ?? (await this.nextRouteSortOrder()),
      },
    });
  }

  async updateRoute(id: string, dto: UpdateSalesRouteDto) {
    const route = await this.prisma.salesRoute.findUnique({ where: { id } });
    if (!route) throw new NotFoundException('Route not found');
    if (dto.name && dto.name !== route.name) {
      await this.assertRouteNameFree(dto.name);
    }
    return this.prisma.salesRoute.update({ where: { id }, data: dto });
  }

  // ─── Prospects ───────────────────────────────────────────────────────────────

  async listProspects(userId: string, query: ProspectQueryDto) {
    return this.list(this.buildWhere(query, userId), query);
  }

  async adminListProspects(query: AdminProspectQueryDto) {
    const where = this.buildWhere(query, undefined, query.includeDeleted);
    if (query.marketerId) where.addedById = query.marketerId;
    if (query.converted !== undefined) {
      where.convertedPharmacyId = query.converted ? { not: null } : null;
    }
    return this.list(where, query);
  }

  async getProspect(id: string, opts: { includeDeleted?: boolean } = {}) {
    const prospect = await this.prisma.pharmacyProspect.findUnique({
      where: { id },
      include: {
        ...PROSPECT_INCLUDE,
        interactions: {
          include: { marketer: PERSON },
          orderBy: { occurredAt: 'desc' },
        },
      },
    });
    if (!prospect || (prospect.deletedAt && !opts.includeDeleted)) {
      throw new NotFoundException('Prospect not found');
    }
    return {
      ...this.present(prospect),
      interactions: prospect.interactions.map((i) =>
        this.presentInteraction(i),
      ),
    };
  }

  async createProspect(userId: string, dto: CreateProspectDto) {
    await this.assertActiveRoute(dto.routeId);
    const phoneNormalized = normalizePhone(dto.phone);
    await this.assertNoDuplicate(phoneNormalized);

    const prospect = await this.prisma.pharmacyProspect.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        phoneNormalized,
        email: dto.email?.toLowerCase(),
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        routeId: dto.routeId,
        storeType: dto.storeType,
        addedById: userId,
      },
      include: PROSPECT_INCLUDE,
    });
    return this.present(prospect);
  }

  async updateProspect(id: string, dto: UpdateProspectDto) {
    const existing = await this.findLive(id);
    const data: Prisma.PharmacyProspectUncheckedUpdateInput = {
      name: dto.name,
      address: dto.address,
      storeType: dto.storeType,
      latitude: dto.latitude,
      longitude: dto.longitude,
    };
    if (dto.routeId && dto.routeId !== existing.routeId) {
      await this.assertActiveRoute(dto.routeId);
      data.routeId = dto.routeId;
    }
    if (dto.phone !== undefined) {
      const phoneNormalized = normalizePhone(dto.phone);
      if (phoneNormalized !== existing.phoneNormalized) {
        await this.assertNoDuplicate(phoneNormalized, id);
      }
      data.phone = dto.phone;
      data.phoneNormalized = phoneNormalized;
    }
    if (dto.email !== undefined) {
      data.email = dto.email === '' ? null : dto.email.toLowerCase();
    }
    const prospect = await this.prisma.pharmacyProspect.update({
      where: { id },
      data,
      include: PROSPECT_INCLUDE,
    });
    return this.present(prospect);
  }

  /** Soft delete: the history stays for reporting and can be restored by an admin. */
  async removeProspect(userId: string, id: string) {
    await this.findLive(id);
    await this.prisma.pharmacyProspect.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId },
    });
    return { id, removed: true };
  }

  async restoreProspect(id: string) {
    const prospect = await this.prisma.pharmacyProspect.findUnique({
      where: { id },
    });
    if (!prospect) throw new NotFoundException('Prospect not found');
    if (!prospect.deletedAt) return this.getProspect(id);
    await this.assertNoDuplicate(prospect.phoneNormalized, id);
    await this.prisma.pharmacyProspect.update({
      where: { id },
      data: { deletedAt: null, deletedById: null },
    });
    return this.getProspect(id);
  }

  /**
   * Records a call or visit. Calls move a prospect from "to call" to "to
   * visit"; a visit (with or without a call first) moves it to "visited".
   * Follow-ups are kept as history; the "last" fields follow the most recent.
   */
  async logInteraction(
    userId: string,
    id: string,
    type: InteractionKind,
    dto: LogInteractionDto,
  ) {
    const prospect = await this.findLive(id);
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + INTERACTION_FUTURE_TOLERANCE_MS) {
      throw new BadRequestException(`A ${type} cannot be logged in the future`);
    }

    const isLatest =
      type === 'call'
        ? !prospect.lastCalledAt || occurredAt >= prospect.lastCalledAt
        : !prospect.lastVisitedAt || occurredAt >= prospect.lastVisitedAt;

    const update: Prisma.PharmacyProspectUncheckedUpdateInput =
      type === 'call'
        ? {
            callCount: { increment: 1 },
            ...(isLatest && {
              lastCallResponse: dto.response,
              lastCalledAt: occurredAt,
            }),
            ...(prospect.stage === 'to_call' && { stage: 'to_visit' }),
          }
        : {
            visitCount: { increment: 1 },
            ...(isLatest && {
              lastVisitResponse: dto.response,
              lastVisitedAt: occurredAt,
            }),
            stage: 'visited',
          };

    await this.prisma.$transaction([
      this.prisma.prospectInteraction.create({
        data: {
          prospectId: id,
          marketerId: userId,
          type,
          response: dto.response,
          comment: dto.comment,
          occurredAt,
          latitude: dto.latitude,
          longitude: dto.longitude,
        },
      }),
      this.prisma.pharmacyProspect.update({ where: { id }, data: update }),
    ]);
    return this.getProspect(id);
  }

  /** Admin: tie a prospect to the FADA pharmacy it became. */
  async linkToPharmacy(id: string, pharmacyId: string) {
    await this.findLive(id);
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { id: true },
    });
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');
    await this.prisma.pharmacyProspect.update({
      where: { id },
      data: { convertedPharmacyId: pharmacyId, convertedAt: new Date() },
    });
    return this.getProspect(id);
  }

  /**
   * Called when a pharmacy registers: any live, unconverted prospect with the
   * same phone (pharmacy's or owner's) or email is marked as converted.
   */
  async markConverted(pharmacyId: string): Promise<number> {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { phone: true, email: true, ownerId: true },
    });
    if (!pharmacy) return 0;
    // ownerId is a plain column (no Prisma relation), so look the owner up
    const owner = await this.prisma.user.findUnique({
      where: { id: pharmacy.ownerId },
      select: { phone: true, email: true },
    });
    const phones = [pharmacy.phone, owner?.phone]
      .filter((p): p is string => !!p)
      .map(normalizePhone);
    const emails = [pharmacy.email, owner?.email]
      .filter((e): e is string => !!e)
      .map((e) => e.toLowerCase());
    if (!phones.length && !emails.length) return 0;

    const { count } = await this.prisma.pharmacyProspect.updateMany({
      where: {
        deletedAt: null,
        convertedPharmacyId: null,
        OR: [
          ...(phones.length ? [{ phoneNormalized: { in: phones } }] : []),
          ...(emails.length ? [{ email: { in: emails } }] : []),
        ],
      },
      data: { convertedPharmacyId: pharmacyId, convertedAt: new Date() },
    });
    if (count) {
      this.logger.log(
        `Pharmacy ${pharmacyId} matched ${count} field-marketing prospect(s)`,
      );
    }
    return count;
  }

  // ─── Summaries ───────────────────────────────────────────────────────────────

  /** Home-screen numbers for a marketer: the team pipeline and their own work. */
  async marketerSummary(userId: string) {
    const today = lagosDay();
    const { start: todayStart } = dayRange(today);
    const { start: weekStart } = dayRange(addDays(today, -6));

    const [pipeline, converted, added, mine] = await Promise.all([
      this.pipelineCounts(),
      this.prisma.pharmacyProspect.count({
        where: { deletedAt: null, convertedPharmacyId: { not: null } },
      }),
      this.prisma.pharmacyProspect.count({
        where: { addedById: userId, deletedAt: null },
      }),
      this.prisma.prospectInteraction.findMany({
        where: { marketerId: userId, occurredAt: { gte: weekStart } },
        select: { type: true, occurredAt: true },
      }),
    ]);

    const tally = (type: InteractionKind, since: Date) =>
      mine.filter((i) => i.type === type && i.occurredAt >= since).length;

    return {
      pipeline: { ...pipeline, converted },
      mine: {
        added,
        callsToday: tally('call', todayStart),
        visitsToday: tally('visit', todayStart),
        callsThisWeek: tally('call', weekStart),
        visitsThisWeek: tally('visit', weekStart),
      },
    };
  }

  /** Back-office funnel: pipeline, period activity, routes and marketers. */
  async adminSummary(query: MarketingSummaryQueryDto) {
    let period;
    try {
      period = resolvePeriod({ from: query.from, to: query.to });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const start = dayRange(period.from).start;
    const end = dayRange(period.to).end;
    const inPeriod = { gte: start, lt: end };

    const [
      pipeline,
      converted,
      removed,
      added,
      conversions,
      interactions,
      routes,
      routeStages,
      routeConverted,
      marketers,
      addedByMarketer,
      convertedByMarketer,
    ] = await Promise.all([
      this.pipelineCounts(),
      this.prisma.pharmacyProspect.count({
        where: { deletedAt: null, convertedPharmacyId: { not: null } },
      }),
      this.prisma.pharmacyProspect.count({
        where: { deletedAt: { not: null } },
      }),
      this.prisma.pharmacyProspect.count({
        where: { createdAt: inPeriod },
      }),
      this.prisma.pharmacyProspect.count({
        where: { convertedAt: inPeriod },
      }),
      this.prisma.prospectInteraction.groupBy({
        by: ['marketerId', 'type', 'response'],
        where: { occurredAt: inPeriod },
        _count: { _all: true },
      }),
      this.prisma.salesRoute.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, isActive: true },
      }),
      this.prisma.pharmacyProspect.groupBy({
        by: ['routeId', 'stage'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.pharmacyProspect.groupBy({
        by: ['routeId'],
        where: { deletedAt: null, convertedPharmacyId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.user.findMany({
        where: { role: 'marketer' },
        select: { ...PERSON.select, isActive: true },
      }),
      this.prisma.pharmacyProspect.groupBy({
        by: ['addedById'],
        where: { createdAt: inPeriod },
        _count: { _all: true },
      }),
      this.prisma.pharmacyProspect.groupBy({
        by: ['addedById'],
        where: { convertedAt: inPeriod },
        _count: { _all: true },
      }),
    ]);

    const responses = () => ({ positive: 0, neutral: 0, negative: 0 });
    const callResponses = responses();
    const visitResponses = responses();
    const perMarketer = new Map<
      string,
      { calls: number; visits: number; positive: number }
    >();
    for (const row of interactions) {
      const n = row._count._all;
      (row.type === 'call' ? callResponses : visitResponses)[row.response] += n;
      const m = perMarketer.get(row.marketerId) ?? {
        calls: 0,
        visits: 0,
        positive: 0,
      };
      if (row.type === 'call') m.calls += n;
      else m.visits += n;
      if (row.response === 'positive') m.positive += n;
      perMarketer.set(row.marketerId, m);
    }
    const sum = (r: Record<string, number>) =>
      Object.values(r).reduce((a, b) => a + b, 0);

    const countMap = (
      rows: { addedById: string; _count: { _all: number } }[],
    ) => new Map(rows.map((r) => [r.addedById, r._count._all]));
    const addedMap = countMap(addedByMarketer);
    const convertedMap = countMap(convertedByMarketer);
    const routeConvertedMap = new Map(
      routeConverted.map((r) => [r.routeId, r._count._all]),
    );

    return {
      period: { from: period.from, to: period.to },
      pipeline: { ...pipeline, converted, removed },
      activity: {
        prospectsAdded: added,
        calls: sum(callResponses),
        visits: sum(visitResponses),
        conversions,
        callResponses,
        visitResponses,
      },
      byRoute: routes.map((r) => {
        const stage = (s: string) =>
          routeStages.find((x) => x.routeId === r.id && x.stage === s)?._count
            ._all ?? 0;
        return {
          route: r,
          toCall: stage('to_call'),
          toVisit: stage('to_visit'),
          visited: stage('visited'),
          converted: routeConvertedMap.get(r.id) ?? 0,
        };
      }),
      byMarketer: marketers
        .map((m) => {
          const work = perMarketer.get(m.id) ?? {
            calls: 0,
            visits: 0,
            positive: 0,
          };
          return {
            marketer: {
              id: m.id,
              name: this.fullName(m),
              isActive: m.isActive,
            },
            added: addedMap.get(m.id) ?? 0,
            ...work,
            conversions: convertedMap.get(m.id) ?? 0,
          };
        })
        .sort((a, b) => b.calls + b.visits - (a.calls + a.visits)),
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private buildWhere(
    query: ProspectQueryDto,
    userId?: string,
    includeDeleted = false,
  ): Prisma.PharmacyProspectWhereInput {
    const where: Prisma.PharmacyProspectWhereInput = {};
    if (!includeDeleted) where.deletedAt = null;
    if (query.stage) where.stage = query.stage;
    if (query.routeId) where.routeId = query.routeId;
    if (query.storeType) where.storeType = query.storeType;
    if (query.mine && userId) where.addedById = userId;
    if (query.search) {
      const term = query.search;
      const digits = term.replace(/\D/g, '');
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { address: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        ...(digits.length >= 4
          ? [
              {
                phoneNormalized: {
                  contains: digits.startsWith('0') ? digits.slice(1) : digits,
                },
              },
            ]
          : []),
      ];
    }
    return where;
  }

  private async list(
    where: Prisma.PharmacyProspectWhereInput,
    query: ProspectQueryDto,
  ) {
    const orderBy: Prisma.PharmacyProspectOrderByWithRelationInput[] =
      query.stage === 'to_visit'
        ? [{ lastCalledAt: 'desc' }, { createdAt: 'desc' }]
        : query.stage === 'visited'
          ? [{ lastVisitedAt: 'desc' }, { createdAt: 'desc' }]
          : query.stage === 'to_call'
            ? [{ createdAt: 'desc' }]
            : [{ updatedAt: 'desc' }];

    const [items, total] = await Promise.all([
      this.prisma.pharmacyProspect.findMany({
        where,
        include: PROSPECT_INCLUDE,
        orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.pharmacyProspect.count({ where }),
    ]);
    return {
      items: items.map((p) => this.present(p)),
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
      },
    };
  }

  private async pipelineCounts() {
    const rows = await this.prisma.pharmacyProspect.groupBy({
      by: ['stage'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const get = (s: string) =>
      rows.find((r) => r.stage === s)?._count._all ?? 0;
    return {
      toCall: get('to_call'),
      toVisit: get('to_visit'),
      visited: get('visited'),
    };
  }

  private async findLive(id: string) {
    const prospect = await this.prisma.pharmacyProspect.findUnique({
      where: { id },
    });
    if (!prospect || prospect.deletedAt) {
      throw new NotFoundException('Prospect not found');
    }
    return prospect;
  }

  private async assertNoDuplicate(phoneNormalized: string, exceptId?: string) {
    const dup = await this.prisma.pharmacyProspect.findFirst({
      where: {
        phoneNormalized,
        deletedAt: null,
        ...(exceptId && { id: { not: exceptId } }),
      },
      select: { id: true, name: true },
    });
    if (dup) {
      throw new ConflictException({
        message: `${dup.name} already uses this phone number`,
        error: 'DuplicateProspect',
        details: { existingProspectId: dup.id, existingName: dup.name },
      });
    }
  }

  private async assertActiveRoute(routeId: string) {
    const route = await this.prisma.salesRoute.findUnique({
      where: { id: routeId },
    });
    if (!route || !route.isActive) {
      throw new BadRequestException('Choose an active sales route');
    }
  }

  private async assertRouteNameFree(name: string) {
    const existing = await this.prisma.salesRoute.findUnique({
      where: { name },
    });
    if (existing) {
      throw new ConflictException('A route with this name already exists');
    }
  }

  private async nextRouteSortOrder(): Promise<number> {
    const last = await this.prisma.salesRoute.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }

  private fullName(p: Person | null): string {
    if (!p) return '';
    return [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  }

  private person(p: Person | null) {
    return p ? { id: p.id, name: this.fullName(p) } : null;
  }

  private present(p: ProspectRow) {
    return {
      id: p.id,
      name: p.name,
      phone: p.phone,
      email: p.email,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      route: p.route,
      storeType: p.storeType,
      stage: p.stage,
      lastCall: p.lastCalledAt
        ? { response: p.lastCallResponse, at: p.lastCalledAt }
        : null,
      lastVisit: p.lastVisitedAt
        ? { response: p.lastVisitResponse, at: p.lastVisitedAt }
        : null,
      callCount: p.callCount,
      visitCount: p.visitCount,
      addedBy: this.person(p.addedBy),
      convertedPharmacy: p.convertedPharmacy,
      convertedAt: p.convertedAt,
      deletedAt: p.deletedAt,
      deletedBy: this.person(p.deletedBy),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private presentInteraction(i: InteractionRow) {
    return {
      id: i.id,
      type: i.type,
      response: i.response,
      comment: i.comment,
      occurredAt: i.occurredAt,
      latitude: i.latitude,
      longitude: i.longitude,
      marketer: this.person(i.marketer),
      createdAt: i.createdAt,
    };
  }
}
