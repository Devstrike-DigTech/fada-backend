import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { RedisService } from '@infra/redis/redis.service';
import {
  EVENTS,
  GeoRadiusExpandedPayload,
  SearchPerformedPayload,
} from '@common/types/events.types';
import { DrugSearchQueryDto } from './dto/drug-search-query.dto';
import { PharmacySearchQueryDto } from './dto/pharmacy-search-query.dto';
import { AilmentSearchQueryDto } from './dto/ailment-search-query.dto';

// ─── Internal raw-query result types ─────────────────────────────────────────

interface RawDrugResult {
  drug_id: string;
  drug_name: string;
  generic_name: string | null;
  alias_name: string | null;
  nafdac_number: string | null;
  price: string;
  stock_status: string;
  stock_amount: number;
  prescription_type: string | null;
  drug_type: string;
  branch_id: string;
  branch_name: string;
  branch_address: string | null;
  branch_lat: number;
  branch_lng: number;
  pharmacy_id: string;
  pharmacy_name: string;
  state: string | null;
  city: string | null;
  is_verified: boolean;
  reputation_level: number;
  pharmacy_logo: string | null;
  distance_km: number | null;
}

interface RawPharmacyResult {
  pharmacy_id: string;
  pharmacy_name: string;
  state: string | null;
  city: string | null;
  pharmacy_address: string | null;
  phone: string | null;
  is_verified: boolean;
  reputation_level: number;
  reputation_points: number;
  pharmacy_logo: string | null;
  branch_id: string;
  branch_name: string;
  branch_address: string | null;
  branch_lat: number;
  branch_lng: number;
  is_head_branch: boolean;
  total_drugs: number;
  in_stock_drugs: number;
  distance_km: number | null;
}

interface PaginationArgs {
  skip: number;
  take: number;
}

interface GuestLimitResult {
  remaining: number;
  limitReached: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GUEST_SEARCH_LIMIT = 20; // max searches per day for a guest
const GUEST_RESULT_LIMIT = 10; // max results per search for a guest
const GUEST_LIMIT_TTL_SECS = 86_400; // 24 hours

const DEFAULT_RADIUS_KM = 5;
const RADIUS_STEPS = [5, 10, 20, 50]; // km — progressive expansion
const MIN_RESULTS_FOR_EXPANSION = 3; // expand if fewer results than this

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
  ) {}

  // ─── Drug Search ────────────────────────────────────────────────────────────

  async searchDrugs(
    userId: string | undefined,
    guestToken: string | undefined,
    dto: DrugSearchQueryDto,
  ) {
    const isGuest = !userId;

    // Enforce guest result cap
    const effectiveTake = isGuest
      ? Math.min(dto.take, GUEST_RESULT_LIMIT)
      : dto.take;

    // Track and check guest search limit
    let guestLimitInfo: GuestLimitResult | null = null;
    if (isGuest) {
      guestLimitInfo = await this.trackAndCheckGuestLimit(guestToken);
    }

    const hasGeo = dto.latitude != null && dto.longitude != null;

    let result: ReturnType<typeof this.buildResult>;
    let expandedRadius = false;
    let originalRadiusKm: number | undefined;
    let finalRadiusKm: number | undefined;

    if (hasGeo) {
      const startRadius = dto.radiusKm ?? DEFAULT_RADIUS_KM;
      result = await this.runGeoDrugSearch(
        dto.q,
        dto.latitude!,
        dto.longitude!,
        startRadius,
        { prescriptionType: dto.prescriptionType, categoryId: dto.categoryId },
        { skip: dto.skip, take: effectiveTake },
      );

      // Auto-expand radius when too few results
      if (result.total < MIN_RESULTS_FOR_EXPANSION) {
        const nextRadius = this.nextRadiusStep(startRadius);
        if (nextRadius > startRadius) {
          originalRadiusKm = startRadius;
          finalRadiusKm = nextRadius;
          expandedRadius = true;

          result = await this.runGeoDrugSearch(
            dto.q,
            dto.latitude!,
            dto.longitude!,
            nextRadius,
            {
              prescriptionType: dto.prescriptionType,
              categoryId: dto.categoryId,
            },
            { skip: dto.skip, take: effectiveTake },
          );

          await this.eventBus.emit(EVENTS.SEARCH.GEO_RADIUS_EXPANDED, {
            userId,
            guestToken,
            query: dto.q,
            previousRadiusKm: startRadius,
            newRadiusKm: nextRadius,
            expandedAt: new Date(),
          } satisfies GeoRadiusExpandedPayload);

          this.logger.debug(
            `Radius expanded ${startRadius}→${nextRadius}km for query "${dto.q}"`,
          );
        }
      }
    } else {
      // No geo — full-catalogue text search across all verified pharmacies
      result = await this.runTextDrugSearch(
        dto.q,
        { prescriptionType: dto.prescriptionType, categoryId: dto.categoryId },
        { skip: dto.skip, take: effectiveTake },
      );
    }

    // Emit analytics events
    await this.eventBus.emit(EVENTS.SEARCH.PERFORMED, {
      userId,
      guestToken,
      query: dto.q,
      latitude: dto.latitude,
      longitude: dto.longitude,
      radiusKm: finalRadiusKm ?? dto.radiusKm ?? DEFAULT_RADIUS_KM,
      resultCount: result.total,
      searchedAt: new Date(),
    } satisfies SearchPerformedPayload);

    if (result.total > 0) {
      await this.eventBus.emit(EVENTS.SEARCH.DRUG_FOUND, {
        query: dto.q,
        count: result.total,
      });
    } else {
      await this.eventBus.emit(EVENTS.SEARCH.DRUG_NOT_FOUND, {
        query: dto.q,
        userId,
        guestToken,
      });
    }

    return {
      data: result.data,
      meta: {
        ...result.meta,
        expandedRadius,
        originalRadiusKm,
        finalRadiusKm,
        isGuest,
        guestSearchesRemaining: guestLimitInfo?.remaining ?? null,
        guestLimitReached: guestLimitInfo?.limitReached ?? false,
      },
    };
  }

  // ─── Pharmacy Search ────────────────────────────────────────────────────────

  async searchPharmacies(
    userId: string | undefined,
    guestToken: string | undefined,
    dto: PharmacySearchQueryDto,
  ) {
    const isGuest = !userId;
    const effectiveTake = isGuest
      ? Math.min(dto.take, GUEST_RESULT_LIMIT)
      : dto.take;

    const hasGeo = dto.latitude != null && dto.longitude != null;

    let result: ReturnType<typeof this.buildResult>;
    let expandedRadius = false;
    let originalRadiusKm: number | undefined;
    let finalRadiusKm: number | undefined;

    if (hasGeo) {
      const startRadius = dto.radiusKm ?? DEFAULT_RADIUS_KM;
      result = await this.runGeoPharmacySearch(
        dto.q,
        dto.latitude!,
        dto.longitude!,
        startRadius,
        { state: dto.state, city: dto.city },
        { skip: dto.skip, take: effectiveTake },
      );

      if (result.total < MIN_RESULTS_FOR_EXPANSION) {
        const nextRadius = this.nextRadiusStep(startRadius);
        if (nextRadius > startRadius) {
          originalRadiusKm = startRadius;
          finalRadiusKm = nextRadius;
          expandedRadius = true;

          result = await this.runGeoPharmacySearch(
            dto.q,
            dto.latitude!,
            dto.longitude!,
            nextRadius,
            { state: dto.state, city: dto.city },
            { skip: dto.skip, take: effectiveTake },
          );

          await this.eventBus.emit(EVENTS.SEARCH.GEO_RADIUS_EXPANDED, {
            userId,
            guestToken,
            query: dto.q ?? '',
            previousRadiusKm: startRadius,
            newRadiusKm: nextRadius,
            expandedAt: new Date(),
          } satisfies GeoRadiusExpandedPayload);
        }
      }
    } else {
      result = await this.runTextPharmacySearch(
        dto.q,
        { state: dto.state, city: dto.city },
        { skip: dto.skip, take: effectiveTake },
      );
    }

    return {
      data: result.data,
      meta: {
        ...result.meta,
        expandedRadius,
        originalRadiusKm,
        finalRadiusKm,
        isGuest,
      },
    };
  }

  // ─── Ailment Search ─────────────────────────────────────────────────────────

  async searchAilments(
    userId: string | undefined,
    guestToken: string | undefined,
    dto: AilmentSearchQueryDto,
  ) {
    const isGuest = !userId;

    const effectiveTake = isGuest
      ? Math.min(dto.take, GUEST_RESULT_LIMIT)
      : dto.take;

    let guestLimitInfo: GuestLimitResult | null = null;
    if (isGuest) {
      guestLimitInfo = await this.trackAndCheckGuestLimit(guestToken);
    }

    const hasGeo = dto.latitude != null && dto.longitude != null;

    let result: ReturnType<typeof this.buildResult>;
    let expandedRadius = false;
    let originalRadiusKm: number | undefined;
    let finalRadiusKm: number | undefined;

    if (hasGeo) {
      const startRadius = dto.radiusKm ?? DEFAULT_RADIUS_KM;
      result = await this.runGeoAilmentSearch(
        dto.q,
        dto.latitude!,
        dto.longitude!,
        startRadius,
        { skip: dto.skip, take: effectiveTake },
      );

      if (result.total < MIN_RESULTS_FOR_EXPANSION) {
        const nextRadius = this.nextRadiusStep(startRadius);
        if (nextRadius > startRadius) {
          originalRadiusKm = startRadius;
          finalRadiusKm = nextRadius;
          expandedRadius = true;

          result = await this.runGeoAilmentSearch(
            dto.q,
            dto.latitude!,
            dto.longitude!,
            nextRadius,
            { skip: dto.skip, take: effectiveTake },
          );

          await this.eventBus.emit(EVENTS.SEARCH.GEO_RADIUS_EXPANDED, {
            userId,
            guestToken,
            query: dto.q,
            previousRadiusKm: startRadius,
            newRadiusKm: nextRadius,
            expandedAt: new Date(),
          } satisfies GeoRadiusExpandedPayload);
        }
      }
    } else {
      result = await this.runTextAilmentSearch(dto.q, {
        skip: dto.skip,
        take: effectiveTake,
      });
    }

    await this.eventBus.emit(EVENTS.SEARCH.PERFORMED, {
      userId,
      guestToken,
      query: dto.q,
      latitude: dto.latitude,
      longitude: dto.longitude,
      radiusKm: finalRadiusKm ?? dto.radiusKm ?? DEFAULT_RADIUS_KM,
      resultCount: result.total,
      searchedAt: new Date(),
    } satisfies SearchPerformedPayload);

    return {
      data: result.data,
      meta: {
        ...result.meta,
        expandedRadius,
        originalRadiusKm,
        finalRadiusKm,
        isGuest,
        guestSearchesRemaining: guestLimitInfo?.remaining ?? null,
        guestLimitReached: guestLimitInfo?.limitReached ?? false,
      },
    };
  }

  // ─── Geo Drug Search (raw SQL + Haversine) ──────────────────────────────────

  private async runGeoDrugSearch(
    q: string,
    lat: number,
    lng: number,
    radiusKm: number,
    filters: { prescriptionType?: string; categoryId?: string },
    pagination: PaginationArgs,
  ) {
    const searchTerm = `%${q}%`;
    const prescriptionType: string | null = filters.prescriptionType ?? null;
    const categoryId: string | null = filters.categoryId ?? null;

    // Inner query: compute Haversine distance from branch coordinates.
    // $1=lat, $2=lng, $3=searchTerm, $4=prescriptionType, $5=categoryId
    const innerSql = `
      SELECT
        d.id                        AS drug_id,
        d.name                      AS drug_name,
        d.generic_name,
        d.alias_name,
        d.nafdac_number,
        d.price::text               AS price,
        d.stock_status,
        d.stock_amount,
        d.prescription_type,
        d.drug_type,
        b.id                        AS branch_id,
        b.name                      AS branch_name,
        b.address                   AS branch_address,
        b.latitude                  AS branch_lat,
        b.longitude                 AS branch_lng,
        p.id                        AS pharmacy_id,
        p.name                      AS pharmacy_name,
        p.state,
        p.city,
        p.is_verified,
        p.reputation_level,
        pi_url.url                  AS pharmacy_logo,
        (
          6371 * acos(
            LEAST(1.0,
              cos(radians($1)) * cos(radians(b.latitude))
              * cos(radians(b.longitude) - radians($2))
              + sin(radians($1)) * sin(radians(b.latitude))
            )
          )
        )                           AS distance_km
      FROM   drugs           d
      JOIN   branches        b  ON d.branch_id      = b.id
      JOIN   pharmacies      p  ON b.pharmacy_id    = p.id
      LEFT JOIN LATERAL (
        SELECT url FROM pharmacy_images
        WHERE  pharmacy_id = p.id AND is_primary = true
        LIMIT  1
      ) pi_url ON true
      WHERE  d.stock_status  != 'out_of_stock'
        AND  b.is_active      = true
        AND  p.is_active      = true
        AND  p.is_verified    = true
        AND  b.latitude       IS NOT NULL
        AND  b.longitude      IS NOT NULL
        AND  (
               d.name         ILIKE $3
          OR   d.generic_name ILIKE $3
          OR   d.alias_name   ILIKE $3
          OR   d.nafdac_number ILIKE $3
        )
        AND  ($4::text IS NULL OR d.prescription_type::text = $4::text)
        AND  ($5::uuid IS NULL OR EXISTS (
               SELECT 1 FROM drug_category_map dcm
               WHERE  dcm.drug_id    = d.id
                 AND  dcm.category_id = $5::uuid
             ))
    `;

    // $6=radiusKm, $7=take, $8=skip
    const [countRows, drugRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COUNT(*)::int AS total FROM (${innerSql}) sub WHERE sub.distance_km <= $6`,
        lat, lng, searchTerm, prescriptionType, categoryId, radiusKm,
      ),
      this.prisma.$queryRawUnsafe<RawDrugResult[]>(
        `SELECT * FROM (${innerSql}) sub WHERE sub.distance_km <= $6 ORDER BY sub.distance_km ASC LIMIT $7 OFFSET $8`,
        lat, lng, searchTerm, prescriptionType, categoryId, radiusKm, pagination.take, pagination.skip,
      ),
    ]);

    const total = countRows[0]?.total ?? 0;
    return this.buildResult(drugRows.map(this.mapDrugRow), total, pagination);
  }

  // ─── Text Drug Search (ORM, no geo) ─────────────────────────────────────────

  private async runTextDrugSearch(
    q: string,
    filters: { prescriptionType?: string; categoryId?: string },
    pagination: PaginationArgs,
  ) {
    const where: Prisma.DrugWhereInput = {
      stockStatus: { not: 'out_of_stock' },
      branch: {
        isActive: true,
        pharmacy: { isActive: true, isVerified: true },
      },
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { genericName: { contains: q, mode: 'insensitive' } },
        { aliasName: { contains: q, mode: 'insensitive' } },
        { nafdacNumber: { contains: q, mode: 'insensitive' } },
      ],
      ...(filters.prescriptionType && {
        prescriptionType: filters.prescriptionType as Prisma.EnumPrescriptionTypeNullableFilter,
      }),
      ...(filters.categoryId && {
        categories: { some: { categoryId: filters.categoryId } },
      }),
    };

    const [total, drugs] = await Promise.all([
      this.prisma.drug.count({ where }),
      this.prisma.drug.findMany({
        where,
        include: {
          branch: {
            include: {
              pharmacy: {
                include: { images: { where: { isPrimary: true }, take: 1 } },
              },
            },
          },
          images: { where: { sortOrder: 0 }, take: 1 },
        },
        orderBy: { name: 'asc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    const data = drugs.map((drug) => ({
      drug: {
        id: drug.id,
        name: drug.name,
        genericName: drug.genericName,
        aliasName: drug.aliasName,
        nafdacNumber: drug.nafdacNumber,
        price: drug.price.toString(),
        stockStatus: drug.stockStatus,
        stockAmount: drug.stockAmount,
        prescriptionType: drug.prescriptionType,
        drugType: drug.drugType,
        imageUrl: drug.images[0]?.url ?? null,
      },
      branch: {
        id: drug.branch.id,
        name: drug.branch.name,
        address: drug.branch.address,
        latitude: drug.branch.latitude,
        longitude: drug.branch.longitude,
        distanceKm: null as null,
      },
      pharmacy: {
        id: drug.branch.pharmacy.id,
        name: drug.branch.pharmacy.name,
        state: drug.branch.pharmacy.state,
        city: drug.branch.pharmacy.city,
        isVerified: drug.branch.pharmacy.isVerified,
        reputationLevel: drug.branch.pharmacy.reputationLevel,
        logoUrl: drug.branch.pharmacy.images[0]?.url ?? null,
      },
    }));

    return this.buildResult(data, total, pagination);
  }

  // ─── Geo Pharmacy Search (raw SQL + Haversine) ──────────────────────────────

  private async runGeoPharmacySearch(
    q: string | undefined,
    lat: number,
    lng: number,
    radiusKm: number,
    filters: { state?: string; city?: string },
    pagination: PaginationArgs,
  ) {
    // null params → SQL IS NULL check skips the filter
    const nameTerm: string | null = q ? `%${q}%` : null;
    const state: string | null = filters.state ? `%${filters.state}%` : null;
    const city: string | null = filters.city ? `%${filters.city}%` : null;

    // $1=lat, $2=lng, $3=nameTerm, $4=state, $5=city
    const innerSql = `
      SELECT
        p.id                     AS pharmacy_id,
        p.name                   AS pharmacy_name,
        p.state,
        p.city,
        p.address                AS pharmacy_address,
        p.phone,
        p.is_verified,
        p.reputation_level,
        p.reputation_points,
        pi_url.url               AS pharmacy_logo,
        b.id                     AS branch_id,
        b.name                   AS branch_name,
        b.address                AS branch_address,
        b.latitude               AS branch_lat,
        b.longitude              AS branch_lng,
        b.is_head_branch,
        (SELECT COUNT(*)::int FROM drugs WHERE branch_id = b.id)                                        AS total_drugs,
        (SELECT COUNT(*)::int FROM drugs WHERE branch_id = b.id AND stock_status != 'out_of_stock')     AS in_stock_drugs,
        (
          6371 * acos(
            LEAST(1.0,
              cos(radians($1)) * cos(radians(b.latitude))
              * cos(radians(b.longitude) - radians($2))
              + sin(radians($1)) * sin(radians(b.latitude))
            )
          )
        )                        AS distance_km
      FROM   pharmacies      p
      JOIN   branches        b  ON b.pharmacy_id  = p.id
      LEFT JOIN LATERAL (
        SELECT url FROM pharmacy_images
        WHERE  pharmacy_id = p.id AND is_primary = true
        LIMIT  1
      ) pi_url ON true
      WHERE  p.is_active   = true
        AND  p.is_verified  = true
        AND  b.is_active    = true
        AND  b.latitude     IS NOT NULL
        AND  b.longitude    IS NOT NULL
        AND  ($3::text IS NULL OR p.name  ILIKE $3::text)
        AND  ($4::text IS NULL OR p.state ILIKE $4::text)
        AND  ($5::text IS NULL OR p.city  ILIKE $5::text)
    `;

    // $6=radiusKm, $7=take, $8=skip
    const [countRows, pharmacyRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COUNT(*)::int AS total FROM (${innerSql}) sub WHERE sub.distance_km <= $6`,
        lat, lng, nameTerm, state, city, radiusKm,
      ),
      this.prisma.$queryRawUnsafe<RawPharmacyResult[]>(
        `SELECT * FROM (${innerSql}) sub WHERE sub.distance_km <= $6 ORDER BY sub.distance_km ASC LIMIT $7 OFFSET $8`,
        lat, lng, nameTerm, state, city, radiusKm, pagination.take, pagination.skip,
      ),
    ]);

    const total = countRows[0]?.total ?? 0;
    return this.buildResult(pharmacyRows.map(this.mapPharmacyRow), total, pagination);
  }

  // ─── Text Pharmacy Search (ORM, no geo) ─────────────────────────────────────

  private async runTextPharmacySearch(
    q: string | undefined,
    filters: { state?: string; city?: string },
    pagination: PaginationArgs,
  ) {
    const where: Prisma.PharmacyWhereInput = {
      isActive: true,
      isVerified: true,
      branches: { some: { isActive: true } },
      ...(q && { name: { contains: q, mode: 'insensitive' } }),
      ...(filters.state && { state: { contains: filters.state, mode: 'insensitive' } }),
      ...(filters.city && { city: { contains: filters.city, mode: 'insensitive' } }),
    };

    const [total, pharmacies] = await Promise.all([
      this.prisma.pharmacy.count({ where }),
      this.prisma.pharmacy.findMany({
        where,
        include: {
          images: { where: { isPrimary: true }, take: 1 },
          branches: {
            where: { isActive: true },
            include: { _count: { select: { drugs: true } } },
            orderBy: { isHeadBranch: 'desc' },
            take: 1, // representative (head) branch for listing
          },
        },
        orderBy: { reputationPoints: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    const data = pharmacies.map((pharmacy) => {
      const branch = pharmacy.branches[0] ?? null;
      return {
        pharmacy: {
          id: pharmacy.id,
          name: pharmacy.name,
          state: pharmacy.state,
          city: pharmacy.city,
          address: pharmacy.address,
          phone: pharmacy.phone,
          isVerified: pharmacy.isVerified,
          reputationLevel: pharmacy.reputationLevel,
          reputationPoints: pharmacy.reputationPoints,
          logoUrl: pharmacy.images[0]?.url ?? null,
        },
        branch: branch
          ? {
              id: branch.id,
              name: branch.name,
              address: branch.address,
              latitude: branch.latitude,
              longitude: branch.longitude,
              isHeadBranch: branch.isHeadBranch,
              distanceKm: null as null,
            }
          : null,
        inventory: {
          totalDrugs: pharmacy.branches.reduce((s, b) => s + b._count.drugs, 0),
          inStockDrugs: null as null, // omitted in text search for perf
        },
      };
    });

    return this.buildResult(data, total, pagination);
  }

  // ─── Geo Ailment Search (raw SQL + Haversine) ───────────────────────────────

  private async runGeoAilmentSearch(
    q: string,
    lat: number,
    lng: number,
    radiusKm: number,
    pagination: PaginationArgs,
  ) {
    const searchTerm = `%${q}%`;

    // $1=lat, $2=lng, $3=searchTerm
    const innerSql = `
      SELECT
        d.id                        AS drug_id,
        d.name                      AS drug_name,
        d.generic_name,
        d.alias_name,
        d.nafdac_number,
        d.price::text               AS price,
        d.stock_status,
        d.stock_amount,
        d.prescription_type,
        d.drug_type,
        b.id                        AS branch_id,
        b.name                      AS branch_name,
        b.address                   AS branch_address,
        b.latitude                  AS branch_lat,
        b.longitude                 AS branch_lng,
        p.id                        AS pharmacy_id,
        p.name                      AS pharmacy_name,
        p.state,
        p.city,
        p.is_verified,
        p.reputation_level,
        pi_url.url                  AS pharmacy_logo,
        (
          6371 * acos(
            LEAST(1.0,
              cos(radians($1)) * cos(radians(b.latitude))
              * cos(radians(b.longitude) - radians($2))
              + sin(radians($1)) * sin(radians(b.latitude))
            )
          )
        )                           AS distance_km
      FROM   drugs           d
      JOIN   branches        b  ON d.branch_id      = b.id
      JOIN   pharmacies      p  ON b.pharmacy_id    = p.id
      LEFT JOIN LATERAL (
        SELECT url FROM pharmacy_images
        WHERE  pharmacy_id = p.id AND is_primary = true
        LIMIT  1
      ) pi_url ON true
      WHERE  d.stock_status  != 'out_of_stock'
        AND  b.is_active      = true
        AND  p.is_active      = true
        AND  p.is_verified    = true
        AND  b.latitude       IS NOT NULL
        AND  b.longitude      IS NOT NULL
        AND  (
          EXISTS (
            SELECT 1 FROM drug_indications di
            WHERE  di.drug_id = d.id AND di.indication ILIKE $3
          )
          OR EXISTS (
            SELECT 1 FROM drug_ailment_tags dat
            JOIN   ailment_tags            at  ON dat.ailment_tag_id = at.id
            WHERE  dat.drug_id = d.id AND at.name ILIKE $3
          )
        )
    `;

    // $4=radiusKm, $5=take, $6=skip
    const [countRows, drugRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COUNT(*)::int AS total FROM (${innerSql}) sub WHERE sub.distance_km <= $4`,
        lat, lng, searchTerm, radiusKm,
      ),
      this.prisma.$queryRawUnsafe<RawDrugResult[]>(
        `SELECT * FROM (${innerSql}) sub WHERE sub.distance_km <= $4 ORDER BY sub.distance_km ASC LIMIT $5 OFFSET $6`,
        lat, lng, searchTerm, radiusKm, pagination.take, pagination.skip,
      ),
    ]);

    const total = countRows[0]?.total ?? 0;
    return this.buildResult(drugRows.map(this.mapDrugRow), total, pagination);
  }

  // ─── Text Ailment Search (ORM, no geo) ──────────────────────────────────────

  private async runTextAilmentSearch(q: string, pagination: PaginationArgs) {
    const where: Prisma.DrugWhereInput = {
      stockStatus: { not: 'out_of_stock' },
      branch: {
        isActive: true,
        pharmacy: { isActive: true, isVerified: true },
      },
      OR: [
        {
          indications: {
            some: { indication: { contains: q, mode: 'insensitive' } },
          },
        },
        {
          ailmentTags: {
            some: {
              ailmentTag: { name: { contains: q, mode: 'insensitive' } },
            },
          },
        },
      ],
    };

    const [total, drugs] = await Promise.all([
      this.prisma.drug.count({ where }),
      this.prisma.drug.findMany({
        where,
        include: {
          branch: {
            include: {
              pharmacy: {
                include: { images: { where: { isPrimary: true }, take: 1 } },
              },
            },
          },
          images: { where: { sortOrder: 0 }, take: 1 },
        },
        orderBy: { name: 'asc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    const data = drugs.map((drug) => ({
      drug: {
        id: drug.id,
        name: drug.name,
        genericName: drug.genericName,
        aliasName: drug.aliasName,
        nafdacNumber: drug.nafdacNumber,
        price: drug.price.toString(),
        stockStatus: drug.stockStatus,
        stockAmount: drug.stockAmount,
        prescriptionType: drug.prescriptionType,
        drugType: drug.drugType,
        imageUrl: drug.images[0]?.url ?? null,
      },
      branch: {
        id: drug.branch.id,
        name: drug.branch.name,
        address: drug.branch.address,
        latitude: drug.branch.latitude,
        longitude: drug.branch.longitude,
        distanceKm: null as null,
      },
      pharmacy: {
        id: drug.branch.pharmacy.id,
        name: drug.branch.pharmacy.name,
        state: drug.branch.pharmacy.state,
        city: drug.branch.pharmacy.city,
        isVerified: drug.branch.pharmacy.isVerified,
        reputationLevel: drug.branch.pharmacy.reputationLevel,
        logoUrl: drug.branch.pharmacy.images[0]?.url ?? null,
      },
    }));

    return this.buildResult(data, total, pagination);
  }

  // ─── Guest Limit Tracking ───────────────────────────────────────────────────

  private async trackAndCheckGuestLimit(
    guestToken?: string,
  ): Promise<GuestLimitResult> {
    if (!guestToken) {
      // Anonymous guest with no token — allow but don't track
      return { remaining: GUEST_SEARCH_LIMIT, limitReached: false };
    }

    const key = `search:guest:${guestToken}`;
    const count = await this.redis.incr(key);

    // Set TTL only on the very first increment
    if (count === 1) {
      await this.redis.expire(key, GUEST_LIMIT_TTL_SECS);
    }

    const limitReached = count > GUEST_SEARCH_LIMIT;

    if (limitReached) {
      await this.eventBus.emit(EVENTS.SEARCH.GUEST_LIMIT_REACHED, {
        guestToken,
        searchCount: count,
        limit: GUEST_SEARCH_LIMIT,
        limitReachedAt: new Date(),
      });
    }

    return {
      remaining: Math.max(0, GUEST_SEARCH_LIMIT - count),
      limitReached,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Returns the next larger radius from the expansion steps, or current if already at max. */
  private nextRadiusStep(current: number): number {
    const next = RADIUS_STEPS.find((r) => r > current);
    return next ?? current;
  }

  private mapDrugRow(row: RawDrugResult) {
    return {
      drug: {
        id: row.drug_id,
        name: row.drug_name,
        genericName: row.generic_name,
        aliasName: row.alias_name,
        nafdacNumber: row.nafdac_number,
        price: row.price,
        stockStatus: row.stock_status,
        stockAmount: row.stock_amount,
        prescriptionType: row.prescription_type,
        drugType: row.drug_type,
      },
      branch: {
        id: row.branch_id,
        name: row.branch_name,
        address: row.branch_address,
        latitude: row.branch_lat,
        longitude: row.branch_lng,
        distanceKm:
          row.distance_km != null
            ? Math.round(row.distance_km * 100) / 100
            : null,
      },
      pharmacy: {
        id: row.pharmacy_id,
        name: row.pharmacy_name,
        state: row.state,
        city: row.city,
        isVerified: row.is_verified,
        reputationLevel: row.reputation_level,
        logoUrl: row.pharmacy_logo,
      },
    };
  }

  private mapPharmacyRow(row: RawPharmacyResult) {
    return {
      pharmacy: {
        id: row.pharmacy_id,
        name: row.pharmacy_name,
        state: row.state,
        city: row.city,
        address: row.pharmacy_address,
        phone: row.phone,
        isVerified: row.is_verified,
        reputationLevel: row.reputation_level,
        reputationPoints: row.reputation_points,
        logoUrl: row.pharmacy_logo,
      },
      branch: {
        id: row.branch_id,
        name: row.branch_name,
        address: row.branch_address,
        latitude: row.branch_lat,
        longitude: row.branch_lng,
        isHeadBranch: row.is_head_branch,
        distanceKm:
          row.distance_km != null
            ? Math.round(row.distance_km * 100) / 100
            : null,
      },
      inventory: {
        totalDrugs: row.total_drugs,
        inStockDrugs: row.in_stock_drugs,
      },
    };
  }

  private buildResult<T>(
    data: T[],
    total: number,
    pagination: PaginationArgs,
  ) {
    const page = pagination.skip === 0 ? 1 : Math.floor(pagination.skip / pagination.take) + 1;
    const limit = pagination.take;
    return {
      data,
      total,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: pagination.skip + limit < total,
        hasPrev: pagination.skip > 0,
      },
    };
  }
}
