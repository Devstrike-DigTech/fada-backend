import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AdCampaign, AdCampaignStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { RedisService } from '@infra/redis/redis.service';
import { CloudinaryService } from '@infra/storage/cloudinary.service';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import {
  AdCampaignPayload,
  AdEngagementPayload,
  AdPaymentSuccessfulPayload,
  AdRatingRecordedPayload,
  AdminActionPayload,
  EVENTS,
} from '@common/types/events.types';
import { SubscriptionEntitlementsService } from '@modules/subscription/subscription-entitlements.service';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { PromotionsService } from '@modules/promotions/promotions.service';
import {
  AD_BASE_RATE_NGN,
  averageRating,
  campaignEnd,
  computeAdPrice,
} from './ad-pricing';
import {
  CampaignAnalyticsQueryDto,
  CampaignCheckoutDto,
  CampaignQueryDto,
  CampaignStatusActionDto,
  CreateCampaignDto,
  QuoteCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';
import {
  AdFeedQueryDto,
  RateAdDto,
  RecordClickDto,
  RecordImpressionsDto,
} from './dto/feed.dto';

const IMPRESSION_DEDUPE_SECS = 60 * 60; // one counted impression per viewer per campaign per hour
const CLICK_DEDUPE_SECS = 60;
const DEFAULT_FEED_RADIUS_KM = 25;

/** Fields whose change sends a campaign back to review */
const REVIEWED_FIELDS: (keyof UpdateCampaignDto)[] = [
  'title',
  'subtitle',
  'description',
  'specialPointsTitle',
  'specialPoints',
  'drugId',
];

const CAMPAIGN_INCLUDE = {
  drug: {
    select: {
      id: true,
      name: true,
      genericName: true,
      price: true,
      drugType: true,
      stockStatus: true,
      images: { where: { isPrimary: true }, take: 1, select: { url: true } },
    },
  },
  pharmacy: {
    select: {
      id: true,
      name: true,
      fadaId: true,
      state: true,
      city: true,
      address: true,
      isVerified: true,
      images: { where: { isPrimary: true }, take: 1, select: { url: true } },
    },
  },
  promotion: { select: { id: true, code: true, name: true } },
} satisfies Prisma.AdCampaignInclude;

type CampaignWithRelations = Prisma.AdCampaignGetPayload<{
  include: typeof CAMPAIGN_INCLUDE;
}>;

interface Viewer {
  customerId?: string;
  guestToken?: string;
}

interface FeedRow {
  id: string;
  distance_km: number | null;
}

/**
 * Ad campaigns: pharmacy-side management and payment, customer-side
 * geo-targeted serving with frequency capping, engagement tracking, ratings,
 * back-office review, and the hourly lifecycle sweep.
 */
@Injectable()
export class AdsService implements OnModuleInit {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
    private readonly cloudinary: CloudinaryService,
    private readonly entitlements: SubscriptionEntitlementsService,
    private readonly subscriptions: SubscriptionService,
    private readonly promotions: PromotionsService,
    @InjectQueue(QUEUE_NAMES.ADS_LIFECYCLE)
    private readonly lifecycleQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.lifecycleQueue.getRepeatableJobs();
      await Promise.all(
        existing.map((j) => this.lifecycleQueue.removeRepeatableByKey(j.key)),
      );
      await this.lifecycleQueue.add(
        'sweep',
        {},
        {
          repeat: { cron: '15 * * * *' },
          removeOnComplete: 24,
          removeOnFail: 24,
        },
      );
      this.logger.log('Ad lifecycle sweep scheduled (hourly)');
    } catch (err) {
      this.logger.error('Failed to schedule ad lifecycle sweep', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pharmacy side
  // ═══════════════════════════════════════════════════════════════════════════

  async listCampaigns(
    userId: string,
    pharmacyId: string,
    query: CampaignQueryDto,
  ) {
    await this.assertOwnerOrOperator(userId, pharmacyId);
    const where: Prisma.AdCampaignWhereInput = {
      pharmacyId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.adCampaign.findMany({
        where,
        include: CAMPAIGN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.adCampaign.count({ where }),
    ]);
    return {
      items: items.map((c) => this.presentForPharmacy(c)),
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
      },
    };
  }

  async getCampaign(userId: string, pharmacyId: string, campaignId: string) {
    await this.assertOwnerOrOperator(userId, pharmacyId);
    const c = await this.loadCampaign(campaignId, pharmacyId);
    return this.presentForPharmacy(c);
  }

  /** Price preview before creating a campaign. */
  async quote(userId: string, pharmacyId: string, dto: QuoteCampaignDto) {
    await this.assertOwnerOrOperator(userId, pharmacyId);
    const ent = await this.entitlements.getEntitlements(pharmacyId);
    return this.buildPricing(pharmacyId, dto, ent.adDiscountPct, dto.promoCode);
  }

  async createCampaign(
    userId: string,
    pharmacyId: string,
    dto: CreateCampaignDto,
  ) {
    await this.assertOwnerOrOperator(userId, pharmacyId);

    const ent = await this.entitlements.getEntitlements(pharmacyId);
    if (!ent.hasAds) {
      throw new ForbiddenException(
        `Ad campaigns are available on Zuko and Aang plans. Your pharmacy is on ${ent.planName}.`,
      );
    }

    const startAt = new Date(dto.startAt);
    if (Number.isNaN(startAt.getTime()))
      throw new BadRequestException('Invalid startAt');
    if (startAt.getTime() < Date.now() - 60 * 60 * 1000) {
      throw new BadRequestException('startAt cannot be in the past');
    }

    if (dto.drugId)
      await this.assertDrugBelongsToPharmacy(dto.drugId, pharmacyId);

    const headBranch = await this.prisma.branch.findFirst({
      where: { pharmacyId, isActive: true },
      orderBy: [{ isHeadBranch: 'desc' }, { createdAt: 'asc' }],
      select: { latitude: true, longitude: true },
    });
    const pharmacy = await this.prisma.pharmacy.findUniqueOrThrow({
      where: { id: pharmacyId },
      select: { state: true },
    });

    const pricing = await this.buildPricing(
      pharmacyId,
      dto,
      ent.adDiscountPct,
      dto.promoCode,
    );

    const campaign = await this.prisma.adCampaign.create({
      data: {
        pharmacyId,
        drugId: dto.drugId,
        title: dto.title,
        subtitle: dto.subtitle,
        description: dto.description,
        specialPointsTitle: dto.specialPointsTitle,
        specialPoints: dto.specialPoints ?? [],
        drugTypeFilter: dto.drugTypeFilter,
        targetRadiusKm: dto.targetRadiusKm ?? 10,
        targetState: dto.targetState ?? pharmacy.state,
        targetLatitude: headBranch?.latitude ?? null,
        targetLongitude: headBranch?.longitude ?? null,
        timeslotStart: startAt,
        timeslotEnd: campaignEnd(startAt, dto.durationWeeks),
        dailyFrequency: dto.dailyFrequency,
        weeklyDays: dto.weeklyDays,
        durationWeeks: dto.durationWeeks,
        baseRateNgn: AD_BASE_RATE_NGN,
        listPriceNgn: pricing.breakdown.listPriceNgn,
        planDiscountPct: pricing.breakdown.planDiscountPct,
        promotionId: pricing.promotion?.id,
        promotionDiscountNgn: pricing.breakdown.promotionDiscountNgn,
        priceNgn: pricing.breakdown.finalPriceNgn,
        budgetNgn: pricing.breakdown.finalPriceNgn,
        status: 'draft',
        reviewStatus: 'pending',
      },
      include: CAMPAIGN_INCLUDE,
    });

    this.emitCampaign(EVENTS.ADS.CAMPAIGN_CREATED, campaign);
    this.emitCampaign(EVENTS.ADS.CAMPAIGN_SUBMITTED, campaign);
    this.logger.log(
      `Campaign ${campaign.id} created for pharmacy ${pharmacyId} (₦${Number(campaign.priceNgn)})`,
    );
    return {
      ...this.presentForPharmacy(campaign),
      pricing,
      promoRejected: pricing.promoRejected,
    };
  }

  async updateCampaign(
    userId: string,
    pharmacyId: string,
    campaignId: string,
    dto: UpdateCampaignDto,
  ) {
    await this.assertOwnerOrOperator(userId, pharmacyId);
    const c = await this.loadCampaign(campaignId, pharmacyId);
    if (c.status === 'cancelled' || c.status === 'expired') {
      throw new ConflictException(`A ${c.status} campaign cannot be edited`);
    }

    const schedulingChanged =
      dto.startAt !== undefined ||
      dto.dailyFrequency !== undefined ||
      dto.weeklyDays !== undefined ||
      dto.durationWeeks !== undefined ||
      dto.promoCode !== undefined;
    if (schedulingChanged && c.paidAt) {
      throw new ConflictException(
        'Schedule and pricing cannot change after payment',
      );
    }
    if (dto.drugId)
      await this.assertDrugBelongsToPharmacy(dto.drugId, pharmacyId);

    const needsReview = REVIEWED_FIELDS.some((f) => dto[f] !== undefined);

    let pricingData: Prisma.AdCampaignUpdateInput = {};
    let pricing: Awaited<ReturnType<AdsService['buildPricing']>> | undefined;
    if (schedulingChanged) {
      const ent = await this.entitlements.getEntitlements(pharmacyId);
      const startAt = dto.startAt ? new Date(dto.startAt) : c.timeslotStart;
      const durationWeeks = dto.durationWeeks ?? c.durationWeeks;
      pricing = await this.buildPricing(
        pharmacyId,
        {
          dailyFrequency: dto.dailyFrequency ?? c.dailyFrequency,
          weeklyDays: dto.weeklyDays ?? c.weeklyDays,
          durationWeeks,
        },
        ent.adDiscountPct,
        dto.promoCode ?? c.promotion?.code ?? undefined,
      );
      pricingData = {
        timeslotStart: startAt,
        timeslotEnd: campaignEnd(startAt, durationWeeks),
        dailyFrequency: dto.dailyFrequency ?? c.dailyFrequency,
        weeklyDays: dto.weeklyDays ?? c.weeklyDays,
        durationWeeks,
        listPriceNgn: pricing.breakdown.listPriceNgn,
        planDiscountPct: pricing.breakdown.planDiscountPct,
        promotion: pricing.promotion
          ? { connect: { id: pricing.promotion.id } }
          : { disconnect: true },
        promotionDiscountNgn: pricing.breakdown.promotionDiscountNgn,
        priceNgn: pricing.breakdown.finalPriceNgn,
        budgetNgn: pricing.breakdown.finalPriceNgn,
      };
    }

    const updated = await this.prisma.adCampaign.update({
      where: { id: campaignId },
      data: {
        title: dto.title,
        subtitle: dto.subtitle,
        description: dto.description,
        specialPointsTitle: dto.specialPointsTitle,
        specialPoints: dto.specialPoints,
        drug: dto.drugId ? { connect: { id: dto.drugId } } : undefined,
        drugTypeFilter: dto.drugTypeFilter,
        targetRadiusKm: dto.targetRadiusKm,
        targetState: dto.targetState,
        ...pricingData,
        ...(needsReview
          ? {
              reviewStatus: 'pending',
              reviewedAt: null,
              reviewedById: null,
              rejectionReason: null,
            }
          : {}),
        // An active campaign whose content changed must be re-approved before serving again
        ...(needsReview && c.status === 'active'
          ? { status: 'paused', pausedAt: new Date() }
          : {}),
      },
      include: CAMPAIGN_INCLUDE,
    });

    if (needsReview) this.emitCampaign(EVENTS.ADS.CAMPAIGN_SUBMITTED, updated);
    return {
      ...this.presentForPharmacy(updated),
      pricing,
      promoRejected: pricing?.promoRejected,
    };
  }

  async uploadCreative(
    userId: string,
    pharmacyId: string,
    campaignId: string,
    file: Express.Multer.File,
  ) {
    await this.assertOwnerOrOperator(userId, pharmacyId);
    const c = await this.loadCampaign(campaignId, pharmacyId);
    if (c.status === 'cancelled' || c.status === 'expired') {
      throw new ConflictException(`A ${c.status} campaign cannot be edited`);
    }

    const result = await this.cloudinary.uploadImage(
      file.buffer,
      `ads/${pharmacyId}`,
    );
    if (c.creativeCloudinaryId) {
      await this.cloudinary
        .deleteImage(c.creativeCloudinaryId)
        .catch(() => undefined);
    }

    const updated = await this.prisma.adCampaign.update({
      where: { id: campaignId },
      data: {
        creativeUrl: result.url,
        creativeCloudinaryId: result.publicId,
        reviewStatus: 'pending',
        reviewedAt: null,
        reviewedById: null,
        rejectionReason: null,
        ...(c.status === 'active'
          ? { status: 'paused', pausedAt: new Date() }
          : {}),
      },
      include: CAMPAIGN_INCLUDE,
    });
    this.emitCampaign(EVENTS.ADS.CAMPAIGN_SUBMITTED, updated);
    return this.presentForPharmacy(updated);
  }

  async changeStatus(
    userId: string,
    pharmacyId: string,
    campaignId: string,
    dto: CampaignStatusActionDto,
  ) {
    await this.assertOwnerOrOperator(userId, pharmacyId);
    const c = await this.loadCampaign(campaignId, pharmacyId);
    const updated = await this.applyStatusAction(c, dto.action, {
      byPharmacy: true,
    });
    return this.presentForPharmacy(updated);
  }

  async deleteCampaign(userId: string, pharmacyId: string, campaignId: string) {
    await this.assertOwnerOrOperator(userId, pharmacyId);
    const c = await this.loadCampaign(campaignId, pharmacyId);

    // Unpaid drafts vanish; anything that was paid is cancelled to keep the billing trail
    if (c.status === 'draft' && !c.paidAt) {
      await this.prisma.adCampaign.delete({ where: { id: campaignId } });
      if (c.creativeCloudinaryId) {
        await this.cloudinary
          .deleteImage(c.creativeCloudinaryId)
          .catch(() => undefined);
      }
      return { deleted: true };
    }
    const updated = await this.applyStatusAction(c, 'cancel', {
      byPharmacy: true,
    });
    return { deleted: false, campaign: this.presentForPharmacy(updated) };
  }

  /** Opens a hosted checkout for the campaign price (via the shared billing path). */
  async checkout(
    userId: string,
    pharmacyId: string,
    campaignId: string,
    dto: CampaignCheckoutDto,
  ) {
    await this.assertOwnership(userId, pharmacyId);
    const c = await this.loadCampaign(campaignId, pharmacyId);
    if (c.paidAt)
      throw new ConflictException('This campaign has already been paid for');
    if (c.status !== 'draft')
      throw new ConflictException(`A ${c.status} campaign cannot be paid for`);
    if (c.reviewStatus === 'rejected') {
      throw new ConflictException(
        'This campaign was rejected; edit it and resubmit before paying',
      );
    }

    const pending = await this.prisma.billingRecord.findFirst({
      where: { adCampaignId: campaignId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (pending && Date.now() - pending.createdAt.getTime() < 15 * 60 * 1000) {
      throw new ConflictException(
        `A checkout for this campaign is already open (ref ${pending.providerReference}). Complete it or retry in a few minutes.`,
      );
    }

    // Price after the plan discount; promotions are applied inside startCheckout
    const amountBeforePromo =
      Number(c.listPriceNgn) * (1 - c.planDiscountPct / 100);

    const result = await this.subscriptions.startCheckout({
      pharmacyId,
      purpose: 'ad_campaign',
      amountNaira: Math.round(amountBeforePromo * 100) / 100,
      description: `Ad campaign "${c.title}" — ${c.durationWeeks} wk × ${c.weeklyDays} d × ${c.dailyFrequency}/day`,
      providerName: dto.provider,
      promoCode: dto.promoCode ?? c.promotion?.code ?? undefined,
      adCampaignId: campaignId,
    });

    // Keep the campaign's stored price in step with what was actually charged
    await this.prisma.adCampaign.update({
      where: { id: campaignId },
      data: {
        promotion: result.promotion
          ? { connect: { id: result.promotion.id } }
          : { disconnect: true },
        promotionDiscountNgn: result.discount ?? 0,
        priceNgn: result.amount ?? c.priceNgn,
        budgetNgn: result.amount ?? c.priceNgn,
      },
    });

    const fresh = await this.loadCampaign(campaignId, pharmacyId);
    return { ...result, campaign: this.presentForPharmacy(fresh) };
  }

  async getAnalytics(
    userId: string,
    pharmacyId: string,
    campaignId: string,
    query: CampaignAnalyticsQueryDto,
  ) {
    await this.assertOwnerOrOperator(userId, pharmacyId);
    const c = await this.loadCampaign(campaignId, pharmacyId);
    return this.buildAnalytics(c, query.days ?? 30);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Customer side
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Active, approved, paid campaigns near the viewer, honouring each campaign's
   * own radius, its weekly-days schedule and the viewer's daily frequency cap.
   */
  async getFeed(viewer: Viewer, query: AdFeedQueryDto) {
    const limit = query.limit ?? 10;
    const hasGeo =
      query.latitude !== undefined && query.longitude !== undefined;
    const radiusKm = query.radiusKm ?? DEFAULT_FEED_RADIUS_KM;
    const viewerKey = viewer.customerId ?? viewer.guestToken ?? null;

    // Postgres ISO day-of-week: Monday = 1 … Sunday = 7. A campaign with
    // weeklyDays = N serves on days 1..N of each week.
    const rows = hasGeo
      ? await this.prisma.$queryRaw<FeedRow[]>`
          SELECT c.id,
                 (6371 * acos(LEAST(1.0,
                    cos(radians(${query.latitude})) * cos(radians(c.target_latitude))
                    * cos(radians(c.target_longitude) - radians(${query.longitude}))
                    + sin(radians(${query.latitude})) * sin(radians(c.target_latitude))
                 ))) AS distance_km
          FROM ad_campaigns c
          WHERE c.status = 'active'
            AND c.review_status = 'approved'
            AND c.paid_at IS NOT NULL
            AND c.timeslot_start <= NOW()
            AND c.timeslot_end >= NOW()
            AND EXTRACT(ISODOW FROM NOW()) <= c.weekly_days
            AND c.target_latitude IS NOT NULL AND c.target_longitude IS NOT NULL
            AND (${query.drugType ?? null}::text IS NULL OR c.drug_type_filter IS NULL OR c.drug_type_filter::text = ${query.drugType ?? null})
            AND (
              ${viewerKey}::text IS NULL OR (
                SELECT COUNT(*) FROM ad_events e
                WHERE e.campaign_id = c.id AND e.type = 'impression'
                  AND e.created_at >= date_trunc('day', NOW())
                  AND (e.customer_id = ${viewerKey} OR e.guest_token = ${viewerKey})
              ) < c.daily_frequency
            )
            AND (6371 * acos(LEAST(1.0,
                    cos(radians(${query.latitude})) * cos(radians(c.target_latitude))
                    * cos(radians(c.target_longitude) - radians(${query.longitude}))
                    + sin(radians(${query.latitude})) * sin(radians(c.target_latitude))
                 ))) <= LEAST(c.target_radius_km, ${radiusKm})
          ORDER BY distance_km ASC, c.rating DESC NULLS LAST, c.created_at DESC
          LIMIT ${limit}
        `
      : await this.prisma.$queryRaw<FeedRow[]>`
          SELECT c.id, NULL::float AS distance_km
          FROM ad_campaigns c
          WHERE c.status = 'active'
            AND c.review_status = 'approved'
            AND c.paid_at IS NOT NULL
            AND c.timeslot_start <= NOW()
            AND c.timeslot_end >= NOW()
            AND EXTRACT(ISODOW FROM NOW()) <= c.weekly_days
            AND (${query.drugType ?? null}::text IS NULL OR c.drug_type_filter IS NULL OR c.drug_type_filter::text = ${query.drugType ?? null})
            AND (${query.state ?? null}::text IS NULL OR c.target_state ILIKE ${query.state ?? null})
            AND (
              ${viewerKey}::text IS NULL OR (
                SELECT COUNT(*) FROM ad_events e
                WHERE e.campaign_id = c.id AND e.type = 'impression'
                  AND e.created_at >= date_trunc('day', NOW())
                  AND (e.customer_id = ${viewerKey} OR e.guest_token = ${viewerKey})
              ) < c.daily_frequency
            )
          ORDER BY c.rating DESC NULLS LAST, c.created_at DESC
          LIMIT ${limit}
        `;

    if (rows.length === 0)
      return { items: [], meta: { radiusKm: hasGeo ? radiusKm : null } };

    const campaigns = await this.prisma.adCampaign.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: CAMPAIGN_INCLUDE,
    });
    const byId = new Map(campaigns.map((c) => [c.id, c]));
    const items = rows
      .map((r) => {
        const c = byId.get(r.id);
        return c
          ? { ...this.presentForCustomer(c), distanceKm: r.distance_km }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      items,
      meta: { radiusKm: hasGeo ? radiusKm : null, count: items.length },
    };
  }

  async getAdDetail(campaignId: string) {
    const c = await this.prisma.adCampaign.findUnique({
      where: { id: campaignId },
      include: CAMPAIGN_INCLUDE,
    });
    if (!c || c.status !== 'active' || c.reviewStatus !== 'approved') {
      throw new NotFoundException('Ad not found');
    }
    return this.presentForCustomer(c);
  }

  async recordImpressions(viewer: Viewer, dto: RecordImpressionsDto) {
    const viewerKey = viewer.customerId ?? viewer.guestToken ?? 'anon';
    const active = await this.prisma.adCampaign.findMany({
      where: { id: { in: dto.campaignIds }, status: 'active' },
      select: { id: true, pharmacyId: true },
    });

    let recorded = 0;
    for (const c of active) {
      const key = `ads:imp:${c.id}:${viewerKey}`;
      if (await this.redis.exists(key)) continue;
      await this.redis.set(key, '1', IMPRESSION_DEDUPE_SECS);

      await this.prisma.$transaction([
        this.prisma.adEvent.create({
          data: {
            campaignId: c.id,
            type: 'impression',
            customerId: viewer.customerId,
            guestToken: viewer.customerId ? undefined : viewer.guestToken,
            latitude: dto.latitude,
            longitude: dto.longitude,
          },
        }),
        this.prisma.adCampaign.update({
          where: { id: c.id },
          data: { impressionsCount: { increment: 1 } },
        }),
      ]);
      recorded++;

      const payload: AdEngagementPayload = {
        campaignId: c.id,
        pharmacyId: c.pharmacyId,
        customerId: viewer.customerId,
        guestToken: viewer.guestToken,
        occurredAt: new Date(),
      };
      this.eventBus.emit(EVENTS.ADS.IMPRESSION_RECORDED, payload);
    }
    return { recorded, skipped: dto.campaignIds.length - recorded };
  }

  async recordClick(viewer: Viewer, dto: RecordClickDto) {
    const viewerKey = viewer.customerId ?? viewer.guestToken ?? 'anon';
    const c = await this.prisma.adCampaign.findUnique({
      where: { id: dto.campaignId },
      select: { id: true, pharmacyId: true, status: true, drugId: true },
    });
    if (!c || c.status !== 'active')
      throw new NotFoundException('Ad not found');

    const key = `ads:click:${c.id}:${viewerKey}`;
    if (await this.redis.exists(key))
      return { recorded: false, drugId: c.drugId };
    await this.redis.set(key, '1', CLICK_DEDUPE_SECS);

    await this.prisma.$transaction([
      this.prisma.adEvent.create({
        data: {
          campaignId: c.id,
          type: 'click',
          customerId: viewer.customerId,
          guestToken: viewer.customerId ? undefined : viewer.guestToken,
          latitude: dto.latitude,
          longitude: dto.longitude,
        },
      }),
      this.prisma.adCampaign.update({
        where: { id: c.id },
        data: { clicksCount: { increment: 1 } },
      }),
    ]);

    const payload: AdEngagementPayload = {
      campaignId: c.id,
      pharmacyId: c.pharmacyId,
      customerId: viewer.customerId,
      guestToken: viewer.guestToken,
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.ADS.CLICK_RECORDED, payload);
    return { recorded: true, drugId: c.drugId };
  }

  async rate(customerId: string, campaignId: string, dto: RateAdDto) {
    const c = await this.prisma.adCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, pharmacyId: true, status: true },
    });
    if (!c || c.status === 'draft' || c.status === 'cancelled') {
      throw new NotFoundException('Ad not found');
    }

    const existing = await this.prisma.adRating.findUnique({
      where: { campaignId_customerId: { campaignId, customerId } },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.adRating.upsert({
        where: { campaignId_customerId: { campaignId, customerId } },
        create: {
          campaignId,
          customerId,
          stars: dto.stars,
          comment: dto.comment,
        },
        update: { stars: dto.stars, comment: dto.comment },
      });
      const agg = await tx.adRating.aggregate({
        where: { campaignId },
        _sum: { stars: true },
        _count: { _all: true },
      });
      const sum = agg._sum.stars ?? 0;
      const count = agg._count._all;
      return tx.adCampaign.update({
        where: { id: campaignId },
        data: {
          ratingSum: sum,
          ratingCount: count,
          rating: averageRating(sum, count),
        },
        select: { rating: true, ratingCount: true },
      });
    });

    const payload: AdRatingRecordedPayload = {
      campaignId,
      pharmacyId: c.pharmacyId,
      customerId,
      stars: dto.stars,
      averageRating: Number(updated.rating ?? 0),
      ratingCount: updated.ratingCount,
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.ADS.RATING_RECORDED, payload);

    return {
      yourRating: dto.stars,
      updated: !!existing,
      averageRating: Number(updated.rating ?? 0),
      ratingCount: updated.ratingCount,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Back office
  // ═══════════════════════════════════════════════════════════════════════════

  async adminListCampaigns(query: {
    status?: AdCampaignStatus;
    reviewStatus?: 'pending' | 'approved' | 'rejected';
    pharmacyId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: Prisma.AdCampaignWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.pharmacyId ? { pharmacyId: query.pharmacyId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              {
                pharmacy: {
                  name: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.adCampaign.findMany({
        where,
        include: CAMPAIGN_INCLUDE,
        orderBy: [{ reviewStatus: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.adCampaign.count({ where }),
    ]);
    return {
      items: items.map((c) => this.presentForPharmacy(c)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async adminGetCampaign(campaignId: string) {
    const c = await this.prisma.adCampaign.findUnique({
      where: { id: campaignId },
      include: CAMPAIGN_INCLUDE,
    });
    if (!c) throw new NotFoundException('Campaign not found');
    const [analytics, billing] = await Promise.all([
      this.buildAnalytics(c, 30),
      this.prisma.billingRecord.findMany({
        where: { adCampaignId: campaignId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    return { ...this.presentForPharmacy(c), analytics, billing };
  }

  async adminReview(
    campaignId: string,
    decision: 'approve' | 'reject',
    reason: string | undefined,
    adminUserId: string,
  ) {
    const c = await this.prisma.adCampaign.findUnique({
      where: { id: campaignId },
      include: CAMPAIGN_INCLUDE,
    });
    if (!c) throw new NotFoundException('Campaign not found');
    if (c.status === 'cancelled' || c.status === 'expired') {
      throw new ConflictException(`A ${c.status} campaign cannot be reviewed`);
    }

    const now = new Date();
    const approved = decision === 'approve';
    let updated = await this.prisma.adCampaign.update({
      where: { id: campaignId },
      data: {
        reviewStatus: approved ? 'approved' : 'rejected',
        reviewedById: adminUserId,
        reviewedAt: now,
        rejectionReason: approved ? null : reason,
        // A rejected live campaign stops serving immediately
        ...(approved
          ? {}
          : c.status === 'active'
            ? { status: 'paused', pausedAt: now }
            : {}),
      },
      include: CAMPAIGN_INCLUDE,
    });

    this.emitCampaign(
      approved ? EVENTS.ADS.CAMPAIGN_APPROVED : EVENTS.ADS.CAMPAIGN_REJECTED,
      updated,
      reason,
    );
    this.emitAdmin(adminUserId, `ads.${decision}`, campaignId, { reason });

    if (approved) updated = await this.activateIfReady(updated);
    return this.presentForPharmacy(updated);
  }

  async adminForceStatus(
    campaignId: string,
    action: 'pause' | 'resume' | 'cancel',
    reason: string,
    adminUserId: string,
  ) {
    const c = await this.prisma.adCampaign.findUnique({
      where: { id: campaignId },
      include: CAMPAIGN_INCLUDE,
    });
    if (!c) throw new NotFoundException('Campaign not found');
    const updated = await this.applyStatusAction(c, action, {
      byPharmacy: false,
      reason,
    });
    this.emitAdmin(adminUserId, `ads.${action}`, campaignId, { reason });
    return this.presentForPharmacy(updated);
  }

  async adminOverview() {
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [byStatus, pendingReview, engagement30, spend30] = await Promise.all([
      this.prisma.adCampaign.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.adCampaign.count({
        where: { reviewStatus: 'pending', status: { in: ['draft', 'paused'] } },
      }),
      this.prisma.adEvent.groupBy({
        by: ['type'],
        where: { createdAt: { gte: since30 } },
        _count: { _all: true },
      }),
      this.prisma.billingRecord.aggregate({
        where: {
          purpose: 'ad_campaign',
          status: 'paid',
          paidAt: { gte: since30 },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    const impressions =
      engagement30.find((e) => e.type === 'impression')?._count._all ?? 0;
    const clicks =
      engagement30.find((e) => e.type === 'click')?._count._all ?? 0;
    return {
      campaignsByStatus: Object.fromEntries(
        byStatus.map((r) => [r.status, r._count._all]),
      ),
      pendingReview,
      last30Days: {
        impressions,
        clicks,
        ctr:
          impressions > 0
            ? Math.round((clicks / impressions) * 10000) / 100
            : 0,
        adRevenueNgn: Number(spend30._sum.amount ?? 0),
        paidCampaigns: spend30._count._all,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle (listener + sweep)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Called by the listener when a campaign's billing record is paid. */
  async onPaymentSuccessful(
    payload: AdPaymentSuccessfulPayload,
  ): Promise<void> {
    const c = await this.prisma.adCampaign.findUnique({
      where: { id: payload.campaignId },
      include: CAMPAIGN_INCLUDE,
    });
    if (!c) {
      this.logger.warn(
        `Ad payment ${payload.reference} for unknown campaign ${payload.campaignId}`,
      );
      return;
    }
    if (c.paidAt) return; // redelivery

    const updated = await this.prisma.adCampaign.update({
      where: { id: c.id },
      data: { paidAt: payload.paidAt },
      include: CAMPAIGN_INCLUDE,
    });
    this.logger.log(`Campaign ${c.id} paid (${payload.reference})`);
    await this.activateIfReady(updated);
  }

  async runLifecycleSweep(): Promise<{
    activated: number;
    expired: number;
    abandoned: number;
  }> {
    const now = new Date();
    const stats = { activated: 0, expired: 0, abandoned: 0 };

    // 1. Scheduled campaigns whose start time arrived
    const due = await this.prisma.adCampaign.findMany({
      where: {
        status: 'draft',
        reviewStatus: 'approved',
        paidAt: { not: null },
        timeslotStart: { lte: now },
        timeslotEnd: { gte: now },
      },
      include: CAMPAIGN_INCLUDE,
    });
    for (const c of due) {
      await this.activateIfReady(c);
      stats.activated++;
    }

    // 2. Campaigns past their end
    const ended = await this.prisma.adCampaign.findMany({
      where: { status: { in: ['active', 'paused'] }, timeslotEnd: { lt: now } },
      include: CAMPAIGN_INCLUDE,
    });
    for (const c of ended) {
      const updated = await this.prisma.adCampaign.update({
        where: { id: c.id },
        data: { status: 'expired' },
        include: CAMPAIGN_INCLUDE,
      });
      this.emitCampaign(EVENTS.ADS.CAMPAIGN_EXPIRED, updated);
      stats.expired++;
    }

    // 3. Drafts that were never paid and whose slot has passed
    const abandoned = await this.prisma.adCampaign.updateMany({
      where: { status: 'draft', paidAt: null, timeslotEnd: { lt: now } },
      data: { status: 'cancelled', cancelledAt: now },
    });
    stats.abandoned = abandoned.count;

    if (stats.activated || stats.expired || stats.abandoned) {
      this.logger.log(
        `Ad sweep: activated=${stats.activated} expired=${stats.expired} abandoned=${stats.abandoned}`,
      );
    }
    return stats;
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  /** Flips a draft to active when it is paid, approved, and inside its slot. */
  private async activateIfReady(
    c: CampaignWithRelations,
  ): Promise<CampaignWithRelations> {
    const now = new Date();
    const ready =
      c.status === 'draft' &&
      c.reviewStatus === 'approved' &&
      c.paidAt !== null &&
      c.timeslotStart <= now &&
      c.timeslotEnd >= now;
    if (!ready) return c;

    const updated = await this.prisma.adCampaign.update({
      where: { id: c.id },
      data: { status: 'active', activatedAt: now, pausedAt: null },
      include: CAMPAIGN_INCLUDE,
    });
    this.emitCampaign(EVENTS.ADS.CAMPAIGN_ACTIVATED, updated);
    this.logger.log(`Campaign ${c.id} is now live`);
    return updated;
  }

  private async applyStatusAction(
    c: CampaignWithRelations,
    action: 'pause' | 'resume' | 'cancel',
    ctx: { byPharmacy: boolean; reason?: string },
  ): Promise<CampaignWithRelations> {
    const now = new Date();
    let data: Prisma.AdCampaignUpdateInput;
    let event: string;

    switch (action) {
      case 'pause':
        if (c.status !== 'active')
          throw new ConflictException('Only active campaigns can be paused');
        data = { status: 'paused', pausedAt: now };
        event = EVENTS.ADS.CAMPAIGN_PAUSED;
        break;
      case 'resume': {
        if (c.status !== 'paused')
          throw new ConflictException('Only paused campaigns can be resumed');
        if (c.reviewStatus !== 'approved') {
          throw new ConflictException(
            'Campaign must be approved before it can resume',
          );
        }
        if (c.timeslotEnd < now)
          throw new ConflictException('Campaign slot has already ended');
        data = {
          status: 'active',
          pausedAt: null,
          activatedAt: c.activatedAt ?? now,
        };
        event = EVENTS.ADS.CAMPAIGN_RESUMED;
        break;
      }
      case 'cancel':
        if (c.status === 'cancelled' || c.status === 'expired') {
          throw new ConflictException(`Campaign is already ${c.status}`);
        }
        data = { status: 'cancelled', cancelledAt: now };
        event = EVENTS.ADS.CAMPAIGN_CANCELLED;
        break;
    }

    const updated = await this.prisma.adCampaign.update({
      where: { id: c.id },
      data,
      include: CAMPAIGN_INCLUDE,
    });
    this.emitCampaign(
      event,
      updated,
      ctx.reason ?? (ctx.byPharmacy ? 'by pharmacy' : 'by admin'),
    );
    return updated;
  }

  private async buildPricing(
    pharmacyId: string,
    input: {
      dailyFrequency: number;
      weeklyDays: number;
      durationWeeks: number;
    },
    planDiscountPct: number,
    promoCode?: string,
  ) {
    const base = computeAdPrice({ ...input, planDiscountPct });
    const quote = await this.promotions.quote({
      target: 'ads',
      pharmacyId,
      amountNgn: base.priceAfterPlanDiscountNgn,
      code: promoCode,
    });
    const breakdown = computeAdPrice({
      ...input,
      planDiscountPct,
      promotionDiscountNgn: quote.discountNgn,
    });
    return {
      breakdown,
      promotion: quote.promotion
        ? {
            id: quote.promotion.id,
            code: quote.promotion.code,
            name: quote.promotion.name,
          }
        : null,
      promoRejected: quote.rejectionReason,
    };
  }

  private async buildAnalytics(c: CampaignWithRelations, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [daily, uniques] = await Promise.all([
      this.prisma.$queryRaw<
        { day: Date; impressions: bigint; clicks: bigint }[]
      >`
        SELECT date_trunc('day', created_at) AS day,
               COUNT(*) FILTER (WHERE type = 'impression') AS impressions,
               COUNT(*) FILTER (WHERE type = 'click')      AS clicks
        FROM ad_events
        WHERE campaign_id = ${c.id} AND created_at >= ${since}
        GROUP BY 1
        ORDER BY 1
      `,
      this.prisma.$queryRaw<{ viewers: bigint }[]>`
        SELECT COUNT(DISTINCT COALESCE(customer_id, guest_token)) AS viewers
        FROM ad_events
        WHERE campaign_id = ${c.id} AND type = 'impression'
      `,
    ]);

    const impressions = c.impressionsCount;
    const clicks = c.clicksCount;
    const spend = Number(c.paidAt ? c.priceNgn : 0);

    return {
      campaignId: c.id,
      status: c.status,
      window: { days, since },
      totals: {
        impressions,
        clicks,
        ctr:
          impressions > 0
            ? Math.round((clicks / impressions) * 10000) / 100
            : 0,
        uniqueViewers: Number(uniques[0]?.viewers ?? 0),
        rating: c.rating === null ? null : Number(c.rating),
        ratingCount: c.ratingCount,
        spendNgn: spend,
        costPerClickNgn:
          clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null,
        costPerThousandImpressionsNgn:
          impressions > 0
            ? Math.round((spend / impressions) * 1000 * 100) / 100
            : null,
      },
      daily: daily.map((d) => ({
        day: d.day,
        impressions: Number(d.impressions),
        clicks: Number(d.clicks),
      })),
    };
  }

  private presentForPharmacy(c: CampaignWithRelations) {
    return {
      ...this.presentForCustomer(c),
      reviewStatus: c.reviewStatus,
      rejectionReason: c.rejectionReason,
      reviewedAt: c.reviewedAt,
      targeting: {
        radiusKm: c.targetRadiusKm,
        state: c.targetState,
        latitude: c.targetLatitude,
        longitude: c.targetLongitude,
        drugTypeFilter: c.drugTypeFilter,
      },
      schedule: {
        startAt: c.timeslotStart,
        endAt: c.timeslotEnd,
        dailyFrequency: c.dailyFrequency,
        weeklyDays: c.weeklyDays,
        durationWeeks: c.durationWeeks,
      },
      pricing: {
        baseRateNgn: Number(c.baseRateNgn),
        listPriceNgn: Number(c.listPriceNgn),
        planDiscountPct: c.planDiscountPct,
        promotion: c.promotion,
        promotionDiscountNgn: Number(c.promotionDiscountNgn),
        priceNgn: Number(c.priceNgn),
        paidAt: c.paidAt,
      },
      stats: {
        impressions: c.impressionsCount,
        clicks: c.clicksCount,
        ctr:
          c.impressionsCount > 0
            ? Math.round((c.clicksCount / c.impressionsCount) * 10000) / 100
            : 0,
      },
      activatedAt: c.activatedAt,
      pausedAt: c.pausedAt,
      cancelledAt: c.cancelledAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  /** Shape consumed by the customer app's ad card and "Ad Info" screen. */
  private presentForCustomer(c: CampaignWithRelations) {
    return {
      id: c.id,
      status: c.status,
      title: c.title,
      subtitle: c.subtitle,
      description: c.description,
      specialPointsTitle: c.specialPointsTitle,
      specialPoints: Array.isArray(c.specialPoints)
        ? (c.specialPoints as string[])
        : [],
      imageUrl: c.creativeUrl ?? c.drug?.images[0]?.url ?? null,
      drug: c.drug
        ? {
            id: c.drug.id,
            name: c.drug.name,
            genericName: c.drug.genericName,
            price: Number(c.drug.price),
            drugType: c.drug.drugType,
            stockStatus: c.drug.stockStatus,
          }
        : null,
      pharmacy: {
        id: c.pharmacy.id,
        name: c.pharmacy.name,
        fadaId: c.pharmacy.fadaId,
        location: [c.pharmacy.city, c.pharmacy.state]
          .filter(Boolean)
          .join(', '),
        address: c.pharmacy.address,
        isVerified: c.pharmacy.isVerified,
        logoUrl: c.pharmacy.images[0]?.url ?? null,
      },
      rating: c.rating === null ? null : Number(c.rating),
      ratingCount: c.ratingCount,
      endsAt: c.timeslotEnd,
    };
  }

  private emitCampaign(event: string, c: AdCampaign, reason?: string): void {
    const payload: AdCampaignPayload = {
      campaignId: c.id,
      pharmacyId: c.pharmacyId,
      title: c.title,
      drugId: c.drugId,
      status: c.status,
      reviewStatus: c.reviewStatus,
      occurredAt: new Date(),
      reason,
    };
    this.eventBus.emit(event, payload);
  }

  private emitAdmin(
    adminUserId: string,
    action: string,
    campaignId: string,
    details: Record<string, unknown>,
  ): void {
    const payload: AdminActionPayload = {
      adminUserId,
      action,
      targetType: 'ad_campaign',
      targetId: campaignId,
      details,
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.ADMIN.ACTION_PERFORMED, payload);
  }

  private async loadCampaign(campaignId: string, pharmacyId: string) {
    const c = await this.prisma.adCampaign.findFirst({
      where: { id: campaignId, pharmacyId },
      include: CAMPAIGN_INCLUDE,
    });
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }

  private async assertDrugBelongsToPharmacy(
    drugId: string,
    pharmacyId: string,
  ): Promise<void> {
    const drug = await this.prisma.drug.findFirst({
      where: { id: drugId, branch: { pharmacyId } },
      select: { id: true },
    });
    if (!drug)
      throw new BadRequestException('Drug does not belong to this pharmacy');
  }

  private async assertOwnership(
    userId: string,
    pharmacyId: string,
  ): Promise<void> {
    const profile = await this.prisma.pharmacistProfile.findFirst({
      where: { userId, pharmacyId, roleInPharmacy: 'owner' },
    });
    if (!profile)
      throw new ForbiddenException(
        'Only the pharmacy owner can pay for campaigns',
      );
  }

  private async assertOwnerOrOperator(
    userId: string,
    pharmacyId: string,
  ): Promise<void> {
    const profile = await this.prisma.pharmacistProfile.findFirst({
      where: {
        userId,
        pharmacyId,
        roleInPharmacy: { in: ['owner', 'operator'] },
      },
    });
    if (!profile) {
      throw new ForbiddenException(
        'Only the pharmacy owner or operator can manage campaigns',
      );
    }
  }
}
