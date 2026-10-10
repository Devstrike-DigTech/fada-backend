import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SearchType } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { SearchPerformedPayload } from '@common/types/events.types';
import { SearchService } from '@modules/search/search.service';
import { ReservationService } from '@modules/reservation/reservation.service';
import { ReservationQueryDto } from '@modules/reservation/dto/reservation-query.dto';
import { DrugSearchQueryDto } from '@modules/search/dto/drug-search-query.dto';
import { AilmentSearchQueryDto } from '@modules/search/dto/ailment-search-query.dto';
import { PharmacySearchQueryDto } from '@modules/search/dto/pharmacy-search-query.dto';
import { RepeatSearchDto, SearchHistoryQueryDto } from './dto/history.dto';

/** Same query within this window updates the existing row instead of adding one */
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
/** Oldest rows beyond this count are trimmed per customer */
const MAX_HISTORY_PER_CUSTOMER = 200;

@Injectable()
export class CustomerHistoryService {
  private readonly logger = new Logger(CustomerHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly reservations: ReservationService,
  ) {}

  // ─── Recording (called by the search.performed listener) ─────────────────────

  async recordSearch(payload: SearchPerformedPayload): Promise<void> {
    const query = payload.query?.trim();
    if (!query) return;
    const customerId = payload.userId;
    const deviceId = customerId ? undefined : payload.guestToken;
    if (!customerId && !deviceId) return;

    // Only customers get history; pharmacists/admins searching are ignored
    if (customerId) {
      const user = await this.prisma.user.findUnique({
        where: { id: customerId },
        select: { role: true },
      });
      if (user?.role !== 'customer') return;
    }

    const searchType: SearchType = payload.searchType ?? 'drug';
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const recent = await this.prisma.customerSearchHistory.findFirst({
      where: {
        ...(customerId ? { customerId } : { deviceId }),
        searchType,
        query: { equals: query, mode: 'insensitive' },
        createdAt: { gte: since },
      },
    });

    if (recent) {
      await this.prisma.customerSearchHistory.update({
        where: { id: recent.id },
        data: {
          resultsCount: payload.resultCount,
          radiusUsedKm: Math.round(payload.radiusKm),
          createdAt: payload.searchedAt,
        },
      });
      return;
    }

    await this.prisma.customerSearchHistory.create({
      data: {
        customerId,
        deviceId,
        query,
        searchType,
        resultsCount: payload.resultCount,
        radiusUsedKm: Math.round(payload.radiusKm),
        createdAt: payload.searchedAt,
      },
    });

    if (customerId) await this.trim(customerId);
  }

  // ─── Search history ──────────────────────────────────────────────────────────

  async listSearches(customerId: string, query: SearchHistoryQueryDto) {
    const where: Prisma.CustomerSearchHistoryWhereInput = {
      customerId,
      ...(query.searchType ? { searchType: query.searchType } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.customerSearchHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.customerSearchHistory.count({ where }),
    ]);
    return {
      items: items.map((h) => ({
        id: h.id,
        query: h.query,
        searchType: h.searchType,
        resultsCount: h.resultsCount,
        radiusUsedKm: h.radiusUsedKm,
        searchedAt: h.createdAt,
      })),
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
      },
    };
  }

  async removeSearch(customerId: string, id: string) {
    const result = await this.prisma.customerSearchHistory.deleteMany({
      where: { id, customerId },
    });
    if (result.count === 0)
      throw new NotFoundException('History entry not found');
    return { deleted: true };
  }

  async clearSearches(customerId: string) {
    const result = await this.prisma.customerSearchHistory.deleteMany({
      where: { customerId },
    });
    return { deleted: result.count };
  }

  /** Re-runs a past search with the viewer's current location. */
  async repeatSearch(customerId: string, id: string, dto: RepeatSearchDto) {
    const entry = await this.prisma.customerSearchHistory.findFirst({
      where: { id, customerId },
    });
    if (!entry) throw new NotFoundException('History entry not found');

    const geo = {
      latitude: dto.latitude,
      longitude: dto.longitude,
      radiusKm: dto.radiusKm ?? entry.radiusUsedKm ?? undefined,
    };

    switch (entry.searchType) {
      case 'drug': {
        const q = Object.assign(new DrugSearchQueryDto(), {
          q: entry.query,
          ...geo,
        });
        return {
          history: this.present(entry),
          result: await this.search.searchDrugs(customerId, undefined, q),
        };
      }
      case 'ailment': {
        const q = Object.assign(new AilmentSearchQueryDto(), {
          q: entry.query,
          ...geo,
        });
        return {
          history: this.present(entry),
          result: await this.search.searchAilments(customerId, undefined, q),
        };
      }
      case 'pharmacy': {
        const q = Object.assign(new PharmacySearchQueryDto(), {
          q: entry.query,
          ...geo,
        });
        return {
          history: this.present(entry),
          result: await this.search.searchPharmacies(customerId, undefined, q),
        };
      }
      default:
        throw new BadRequestException('Unknown search type');
    }
  }

  // ─── Reservation history ─────────────────────────────────────────────────────

  async listReservations(customerId: string, query: ReservationQueryDto) {
    return this.reservations.listCustomerReservations(customerId, query);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private present(h: {
    id: string;
    query: string;
    searchType: SearchType;
    resultsCount: number;
    radiusUsedKm: number | null;
    createdAt: Date;
  }) {
    return {
      id: h.id,
      query: h.query,
      searchType: h.searchType,
      resultsCount: h.resultsCount,
      radiusUsedKm: h.radiusUsedKm,
      searchedAt: h.createdAt,
    };
  }

  private async trim(customerId: string): Promise<void> {
    const count = await this.prisma.customerSearchHistory.count({
      where: { customerId },
    });
    if (count <= MAX_HISTORY_PER_CUSTOMER) return;
    const overflow = await this.prisma.customerSearchHistory.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
      take: count - MAX_HISTORY_PER_CUSTOMER,
      select: { id: true },
    });
    await this.prisma.customerSearchHistory.deleteMany({
      where: { id: { in: overflow.map((o) => o.id) } },
    });
  }
}
