import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import {
  CustomerListPayload,
  CustomerSavePayload,
  EVENTS,
} from '@common/types/events.types';
import { ReservationService } from '@modules/reservation/reservation.service';
import {
  AddListItemDto,
  CreateDrugListDto,
  RenameDrugListDto,
  ReserveFromListDto,
  SaveStatusQueryDto,
  SavedItemsQueryDto,
  UpdateListItemDto,
} from './dto/saves.dto';
import { haversineKm } from './customer-geo.util';

const MAX_LISTS = 20;
const MAX_ITEMS_PER_LIST = 50;

const DRUG_CARD_SELECT = {
  id: true,
  name: true,
  genericName: true,
  composition: true,
  packageType: true,
  price: true,
  stockStatus: true,
  stockAmount: true,
  drugType: true,
  prescriptionType: true,
  images: { where: { isPrimary: true }, take: 1, select: { url: true } },
  branch: {
    select: {
      id: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      isActive: true,
      pharmacy: {
        select: {
          id: true,
          name: true,
          isVerified: true,
          isActive: true,
          reputationLevel: true,
          images: {
            where: { isPrimary: true },
            take: 1,
            select: { url: true },
          },
        },
      },
    },
  },
} satisfies Prisma.DrugSelect;

type DrugCard = Prisma.DrugGetPayload<{ select: typeof DRUG_CARD_SELECT }>;

const PHARMACY_CARD_SELECT = {
  id: true,
  name: true,
  fadaId: true,
  address: true,
  city: true,
  state: true,
  phone: true,
  isVerified: true,
  isActive: true,
  reputationLevel: true,
  foundedYear: true,
  images: { where: { isPrimary: true }, take: 1, select: { url: true } },
  branches: {
    where: { isActive: true },
    orderBy: [{ isHeadBranch: 'desc' as const }, { createdAt: 'asc' as const }],
    take: 1,
    select: { id: true, latitude: true, longitude: true },
  },
  subscription: {
    select: { plan: { select: { sortOrder: true, name: true } } },
  },
} satisfies Prisma.PharmacySelect;

type PharmacyCard = Prisma.PharmacyGetPayload<{
  select: typeof PHARMACY_CARD_SELECT;
}>;

@Injectable()
export class SavesService {
  private readonly logger = new Logger(SavesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly reservations: ReservationService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Saved drugs
  // ═══════════════════════════════════════════════════════════════════════════

  async listSavedDrugs(customerId: string, query: SavedItemsQueryDto) {
    const [rows, total] = await Promise.all([
      this.prisma.customerSavedDrug.findMany({
        where: { customerId },
        include: { drug: { select: DRUG_CARD_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.customerSavedDrug.count({ where: { customerId } }),
    ]);
    return {
      items: rows.map((r) => ({
        savedAt: r.createdAt,
        ...this.presentDrug(r.drug, query.latitude, query.longitude),
      })),
      meta: this.meta(query, total),
    };
  }

  async saveDrug(customerId: string, drugId: string) {
    const drug = await this.prisma.drug.findUnique({
      where: { id: drugId },
      select: { id: true, branch: { select: { pharmacyId: true } } },
    });
    if (!drug) throw new NotFoundException('Drug not found');

    const existing = await this.prisma.customerSavedDrug.findUnique({
      where: { customerId_drugId: { customerId, drugId } },
    });
    if (existing)
      return { saved: true, alreadySaved: true, savedAt: existing.createdAt };

    const row = await this.prisma.customerSavedDrug.create({
      data: { customerId, drugId },
    });
    const payload: CustomerSavePayload = {
      customerId,
      targetId: drugId,
      pharmacyId: drug.branch.pharmacyId,
      occurredAt: row.createdAt,
    };
    this.eventBus.emit(EVENTS.CUSTOMER.DRUG_SAVED, payload);
    return { saved: true, alreadySaved: false, savedAt: row.createdAt };
  }

  async unsaveDrug(customerId: string, drugId: string) {
    const result = await this.prisma.customerSavedDrug.deleteMany({
      where: { customerId, drugId },
    });
    if (result.count > 0) {
      const payload: CustomerSavePayload = {
        customerId,
        targetId: drugId,
        occurredAt: new Date(),
      };
      this.eventBus.emit(EVENTS.CUSTOMER.DRUG_UNSAVED, payload);
    }
    return { saved: false, removed: result.count > 0 };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Saved pharmacies
  // ═══════════════════════════════════════════════════════════════════════════

  async listSavedPharmacies(customerId: string, query: SavedItemsQueryDto) {
    const [rows, total] = await Promise.all([
      this.prisma.customerSavedPharmacy.findMany({
        where: { customerId },
        include: { pharmacy: { select: PHARMACY_CARD_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.customerSavedPharmacy.count({ where: { customerId } }),
    ]);
    return {
      items: rows.map((r) => ({
        savedAt: r.createdAt,
        ...this.presentPharmacy(r.pharmacy, query.latitude, query.longitude),
      })),
      meta: this.meta(query, total),
    };
  }

  async savePharmacy(customerId: string, pharmacyId: string) {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { id: true },
    });
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');

    const existing = await this.prisma.customerSavedPharmacy.findUnique({
      where: { customerId_pharmacyId: { customerId, pharmacyId } },
    });
    if (existing)
      return { saved: true, alreadySaved: true, savedAt: existing.createdAt };

    const row = await this.prisma.customerSavedPharmacy.create({
      data: { customerId, pharmacyId },
    });
    const payload: CustomerSavePayload = {
      customerId,
      targetId: pharmacyId,
      pharmacyId,
      occurredAt: row.createdAt,
    };
    this.eventBus.emit(EVENTS.CUSTOMER.PHARMACY_SAVED, payload);
    return { saved: true, alreadySaved: false, savedAt: row.createdAt };
  }

  async unsavePharmacy(customerId: string, pharmacyId: string) {
    const result = await this.prisma.customerSavedPharmacy.deleteMany({
      where: { customerId, pharmacyId },
    });
    if (result.count > 0) {
      const payload: CustomerSavePayload = {
        customerId,
        targetId: pharmacyId,
        pharmacyId,
        occurredAt: new Date(),
      };
      this.eventBus.emit(EVENTS.CUSTOMER.PHARMACY_UNSAVED, payload);
    }
    return { saved: false, removed: result.count > 0 };
  }

  /** Lets the app mark hearts without fetching whole lists. */
  async saveStatus(customerId: string, query: SaveStatusQueryDto) {
    const drugIds = query.drugIds ?? [];
    const pharmacyIds = query.pharmacyIds ?? [];

    const [savedDrugs, savedPharmacies] = await Promise.all([
      drugIds.length
        ? this.prisma.customerSavedDrug.findMany({
            where: { customerId, drugId: { in: drugIds } },
            select: { drugId: true },
          })
        : Promise.resolve([] as { drugId: string }[]),
      pharmacyIds.length
        ? this.prisma.customerSavedPharmacy.findMany({
            where: { customerId, pharmacyId: { in: pharmacyIds } },
            select: { pharmacyId: true },
          })
        : Promise.resolve([] as { pharmacyId: string }[]),
    ]);

    const drugSet = new Set(savedDrugs.map((d) => d.drugId));
    const pharmacySet = new Set(savedPharmacies.map((p) => p.pharmacyId));

    return {
      drugs: Object.fromEntries(drugIds.map((id) => [id, drugSet.has(id)])),
      pharmacies: Object.fromEntries(
        pharmacyIds.map((id) => [id, pharmacySet.has(id)]),
      ),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Drug lists
  // ═══════════════════════════════════════════════════════════════════════════

  async listLists(customerId: string) {
    const lists = await this.prisma.customerDrugList.findMany({
      where: { customerId },
      include: {
        items: {
          include: {
            drug: {
              select: {
                price: true,
                images: {
                  where: { isPrimary: true },
                  take: 1,
                  select: { url: true },
                },
              },
            },
          },
          orderBy: { addedAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return lists.map((l) => ({
      id: l.id,
      name: l.name,
      itemCount: l.items.length,
      totalQuantity: l.items.reduce((acc, i) => acc + i.quantity, 0),
      totalPrice: this.round2(
        l.items.reduce((acc, i) => acc + Number(i.drug.price) * i.quantity, 0),
      ),
      previewImages: l.items
        .map((i) => i.drug.images[0]?.url)
        .filter(Boolean)
        .slice(0, 4),
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    }));
  }

  async createList(customerId: string, dto: CreateDrugListDto) {
    const count = await this.prisma.customerDrugList.count({
      where: { customerId },
    });
    if (count >= MAX_LISTS)
      throw new BadRequestException(`You can have at most ${MAX_LISTS} lists`);

    const clash = await this.prisma.customerDrugList.findFirst({
      where: {
        customerId,
        name: { equals: dto.name.trim(), mode: 'insensitive' },
      },
    });
    if (clash)
      throw new ConflictException('You already have a list with that name');

    const list = await this.prisma.customerDrugList.create({
      data: { customerId, name: dto.name.trim() },
    });
    const payload: CustomerListPayload = {
      customerId,
      listId: list.id,
      name: list.name,
      itemCount: 0,
      occurredAt: list.createdAt,
    };
    this.eventBus.emit(EVENTS.CUSTOMER.LIST_CREATED, payload);
    return { ...list, itemCount: 0, totalPrice: 0 };
  }

  async renameList(customerId: string, listId: string, dto: RenameDrugListDto) {
    await this.loadList(customerId, listId);
    const clash = await this.prisma.customerDrugList.findFirst({
      where: {
        customerId,
        name: { equals: dto.name.trim(), mode: 'insensitive' },
        NOT: { id: listId },
      },
    });
    if (clash)
      throw new ConflictException('You already have a list with that name');
    return this.prisma.customerDrugList.update({
      where: { id: listId },
      data: { name: dto.name.trim() },
    });
  }

  async deleteList(customerId: string, listId: string) {
    await this.loadList(customerId, listId);
    await this.prisma.customerDrugList.delete({ where: { id: listId } });
    return { deleted: true };
  }

  async getList(customerId: string, listId: string, query: SavedItemsQueryDto) {
    const list = await this.prisma.customerDrugList.findFirst({
      where: { id: listId, customerId },
      include: {
        items: {
          include: { drug: { select: DRUG_CARD_SELECT } },
          orderBy: { addedAt: 'asc' },
        },
      },
    });
    if (!list) throw new NotFoundException('List not found');

    const items = list.items.map((i) => ({
      itemId: i.id,
      quantity: i.quantity,
      subtotal: this.round2(Number(i.drug.price) * i.quantity),
      addedAt: i.addedAt,
      ...this.presentDrug(i.drug, query.latitude, query.longitude),
    }));

    // Group by branch so the app can offer "Reserve all from <branch>"
    const byBranch = new Map<
      string,
      {
        branchId: string;
        branchName: string;
        pharmacyName: string;
        itemCount: number;
        total: number;
        allAvailable: boolean;
      }
    >();
    for (const i of list.items) {
      const b = i.drug.branch;
      const g = byBranch.get(b.id) ?? {
        branchId: b.id,
        branchName: b.name,
        pharmacyName: b.pharmacy.name,
        itemCount: 0,
        total: 0,
        allAvailable: true,
      };
      g.itemCount++;
      g.total = this.round2(g.total + Number(i.drug.price) * i.quantity);
      if (
        i.drug.stockStatus === 'out_of_stock' ||
        i.drug.stockAmount < i.quantity
      )
        g.allAvailable = false;
      byBranch.set(b.id, g);
    }

    return {
      id: list.id,
      name: list.name,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      itemCount: items.length,
      totalQuantity: items.reduce((acc, i) => acc + i.quantity, 0),
      totalPrice: this.round2(items.reduce((acc, i) => acc + i.subtotal, 0)),
      items,
      branches: [...byBranch.values()],
      canReserveInOneTrip: byBranch.size === 1,
    };
  }

  async addItem(customerId: string, listId: string, dto: AddListItemDto) {
    const list = await this.loadList(customerId, listId);
    const drug = await this.prisma.drug.findUnique({
      where: { id: dto.drugId },
      select: { id: true },
    });
    if (!drug) throw new NotFoundException('Drug not found');

    const existing = await this.prisma.customerDrugListItem.findFirst({
      where: { listId, drugId: dto.drugId },
    });
    if (existing) {
      return this.prisma.customerDrugListItem.update({
        where: { id: existing.id },
        data: {
          quantity: Math.min(99, existing.quantity + (dto.quantity ?? 1)),
        },
      });
    }

    const count = await this.prisma.customerDrugListItem.count({
      where: { listId },
    });
    if (count >= MAX_ITEMS_PER_LIST) {
      throw new BadRequestException(
        `A list can hold at most ${MAX_ITEMS_PER_LIST} drugs`,
      );
    }

    const [item] = await this.prisma.$transaction([
      this.prisma.customerDrugListItem.create({
        data: { listId, drugId: dto.drugId, quantity: dto.quantity ?? 1 },
      }),
      this.prisma.customerDrugList.update({
        where: { id: list.id },
        data: { updatedAt: new Date() },
      }),
    ]);
    return item;
  }

  async updateItem(
    customerId: string,
    listId: string,
    drugId: string,
    dto: UpdateListItemDto,
  ) {
    await this.loadList(customerId, listId);
    const item = await this.prisma.customerDrugListItem.findFirst({
      where: { listId, drugId },
    });
    if (!item) throw new NotFoundException('Drug is not in this list');
    return this.prisma.customerDrugListItem.update({
      where: { id: item.id },
      data: { quantity: dto.quantity },
    });
  }

  async removeItem(customerId: string, listId: string, drugId: string) {
    await this.loadList(customerId, listId);
    const result = await this.prisma.customerDrugListItem.deleteMany({
      where: { listId, drugId },
    });
    if (result.count === 0)
      throw new NotFoundException('Drug is not in this list');
    return { removed: true };
  }

  /**
   * Batch reservation from a list. A reservation is single-branch, so when the
   * list spans branches the caller must pick one; only that branch's drugs are
   * reserved and the rest are reported back.
   */
  async reserveFromList(
    customerId: string,
    listId: string,
    dto: ReserveFromListDto,
  ) {
    const list = await this.prisma.customerDrugList.findFirst({
      where: { id: listId, customerId },
      include: {
        items: {
          include: {
            drug: { select: { id: true, branchId: true, name: true } },
          },
        },
      },
    });
    if (!list) throw new NotFoundException('List not found');
    if (list.items.length === 0)
      throw new BadRequestException('This list is empty');

    const branchIds = [...new Set(list.items.map((i) => i.drug.branchId))];
    let branchId = dto.branchId;
    if (!branchId) {
      if (branchIds.length > 1) {
        throw new BadRequestException(
          `This list spans ${branchIds.length} branches. Pass branchId to choose which one to reserve from.`,
        );
      }
      branchId = branchIds[0];
    }

    const inBranch = list.items.filter((i) => i.drug.branchId === branchId);
    if (inBranch.length === 0) {
      throw new BadRequestException(
        'None of the drugs in this list are stocked at that branch',
      );
    }

    const reservation = await this.reservations.createReservation(customerId, {
      branchId,
      items: inBranch.map((i) => ({ drugId: i.drugId, quantity: i.quantity })),
      notes: dto.notes ?? `From list "${list.name}"`,
    });

    const payload: CustomerListPayload = {
      customerId,
      listId,
      name: list.name,
      itemCount: inBranch.length,
      reservationId: reservation.id,
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.CUSTOMER.LIST_RESERVED, payload);

    return {
      reservation,
      reservedCount: inBranch.length,
      skipped: list.items
        .filter((i) => i.drug.branchId !== branchId)
        .map((i) => ({
          drugId: i.drugId,
          name: i.drug.name,
          reason: 'different branch',
        })),
    };
  }

  // ─── Presenters & helpers ────────────────────────────────────────────────────

  private presentDrug(d: DrugCard, lat?: number, lng?: number) {
    const b = d.branch;
    return {
      drugId: d.id,
      name: d.name,
      genericName: d.genericName,
      composition: d.composition,
      packageType: d.packageType,
      price: Number(d.price),
      stockStatus: d.stockStatus,
      stockAmount: d.stockAmount,
      drugType: d.drugType,
      prescriptionType: d.prescriptionType,
      imageUrl: d.images[0]?.url ?? null,
      isAvailable:
        d.stockStatus !== 'out_of_stock' && b.isActive && b.pharmacy.isActive,
      branch: { id: b.id, name: b.name, address: b.address },
      pharmacy: {
        id: b.pharmacy.id,
        name: b.pharmacy.name,
        isVerified: b.pharmacy.isVerified,
        reputationLevel: b.pharmacy.reputationLevel,
        logoUrl: b.pharmacy.images[0]?.url ?? null,
      },
      distanceKm:
        lat !== undefined && lng !== undefined
          ? haversineKm(lat, lng, b.latitude, b.longitude)
          : null,
    };
  }

  private presentPharmacy(p: PharmacyCard, lat?: number, lng?: number) {
    const head = p.branches[0];
    return {
      pharmacyId: p.id,
      name: p.name,
      fadaId: p.fadaId,
      address: [p.address, p.city, p.state].filter(Boolean).join(', '),
      phone: p.phone,
      isVerified: p.isVerified,
      isActive: p.isActive,
      reputationLevel: p.reputationLevel,
      subscriptionLevel: p.subscription?.plan.sortOrder ?? 0,
      planName: p.subscription?.plan.name ?? null,
      yearsActive: p.foundedYear
        ? new Date().getFullYear() - p.foundedYear
        : null,
      logoUrl: p.images[0]?.url ?? null,
      headBranchId: head?.id ?? null,
      distanceKm:
        lat !== undefined && lng !== undefined && head
          ? haversineKm(lat, lng, head.latitude, head.longitude)
          : null,
    };
  }

  private async loadList(customerId: string, listId: string) {
    const list = await this.prisma.customerDrugList.findFirst({
      where: { id: listId, customerId },
    });
    if (!list) throw new NotFoundException('List not found');
    return list;
  }

  private meta(query: SavedItemsQueryDto, total: number) {
    return {
      page: query.page ?? 1,
      limit: query.take,
      total,
      totalPages: Math.ceil(total / query.take),
    };
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
