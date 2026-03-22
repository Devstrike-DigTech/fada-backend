import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { CloudinaryService } from '@infra/storage/cloudinary.service';
import { StorageService } from '@infra/storage/storage.service';
import { RedisService } from '@infra/redis/redis.service';
import {
  DRUG_INFO_PROVIDER,
  IDrugInfoProvider,
} from '@infra/nafdac/drug-info.interface';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { EVENTS } from '@common/types/events.types';
import { AddDrugDto } from './dto/add-drug.dto';
import { UpdateDrugDto } from './dto/update-drug.dto';
import { UpdateStockDto, StockUpdateMode } from './dto/update-stock.dto';
import { InventoryQueryDto } from './dto/inventory-query.dto';

const NAFDAC_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days in Redis
const LOW_STOCK_THRESHOLD_DEFAULT = 5;

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly cloudinary: CloudinaryService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    @Inject(DRUG_INFO_PROVIDER)
    private readonly drugInfoProvider: IDrugInfoProvider,
    @InjectQueue(QUEUE_NAMES.INVENTORY_BATCH_UPLOAD)
    private readonly batchQueue: Queue,
  ) {}

  // ─── NAFDAC Lookup (public endpoint, cached) ────────────────────────────────

  async lookupNafdac(nafdacNumber: string) {
    const cacheKey = `nafdac:${nafdacNumber.replace(/\s/g, '').toLowerCase()}`;

    // 1. Try Redis cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`NAFDAC cache hit: ${nafdacNumber}`);
      return { source: 'cache', data: JSON.parse(cached) as unknown };
    }

    // 2. Try DB cache (NafdacCache table)
    const dbCache = await this.prisma.nafdacCache.findUnique({
      where: { nafdacNumber },
    });
    if (dbCache) {
      await this.redis.set(cacheKey, JSON.stringify(dbCache), NAFDAC_CACHE_TTL);
      return { source: 'db_cache', data: dbCache };
    }

    // 3. Hit the provider
    const result = await this.drugInfoProvider.lookupByNafdacNumber(nafdacNumber);

    if (!result.found) {
      return { source: 'provider', data: null };
    }

    // 4. Persist to DB cache and Redis
    const upserted = await this.prisma.nafdacCache.upsert({
      where: { nafdacNumber },
      create: {
        nafdacNumber,
        name: result.name,
        manufacturer: result.manufacturer,
        composition: result.composition,
        drugType: result.drugType,
        rawData: result.rawData as Prisma.InputJsonValue,
      },
      update: {
        name: result.name,
        manufacturer: result.manufacturer,
        composition: result.composition,
        drugType: result.drugType,
        rawData: result.rawData as Prisma.InputJsonValue,
      },
    });

    await this.redis.set(cacheKey, JSON.stringify(upserted), NAFDAC_CACHE_TTL);

    return { source: 'provider', data: upserted };
  }

  async searchDrugsByName(name: string) {
    const results = await this.drugInfoProvider.lookupByName(name);
    return { results };
  }

  // ─── Add Drug to Branch ─────────────────────────────────────────────────────

  async addDrug(
    pharmacistUserId: string,
    branchId: string,
    dto: AddDrugDto,
  ) {
    await this.assertBranchAccess(pharmacistUserId, branchId);

    // If a NAFDAC number is supplied, auto-enrich from provider/cache
    let enriched: Partial<AddDrugDto> = {};
    if (dto.nafdacNumber) {
      const lookup = await this.lookupNafdac(dto.nafdacNumber);
      if (lookup.data) {
        const d = lookup.data as {
          name?: string;
          genericName?: string;
          manufacturer?: string;
          composition?: string;
          drugType?: string;
          packageType?: string;
        };
        enriched = {
          name: dto.name || d.name,
          genericName: dto.genericName ?? d.genericName,
          manufacturer: dto.manufacturer ?? d.manufacturer,
          composition: dto.composition ?? d.composition,
          drugType: dto.drugType ?? (d.drugType as AddDrugDto['drugType']),
          packageType: dto.packageType ?? d.packageType,
        };
      }
    }

    const merged = { ...dto, ...enriched };

    const drug = await this.prisma.$transaction(async (tx) => {
      const newDrug = await tx.drug.create({
        data: {
          branchId,
          nafdacNumber: merged.nafdacNumber,
          nafdacVerified: !!merged.nafdacNumber,
          name: merged.name!,
          genericName: merged.genericName,
          aliasName: merged.aliasName,
          manufacturer: merged.manufacturer,
          composition: merged.composition,
          drugType: merged.drugType ?? 'oral',
          packageType: merged.packageType,
          adultDosage: merged.adultDosage,
          childrenDosage: merged.childrenDosage,
          price: merged.price!,
          stockAmount: merged.stockAmount ?? 0,
          stockStatus: this.computeStockStatus(
            merged.stockAmount ?? 0,
            merged.lowStockThreshold ?? LOW_STOCK_THRESHOLD_DEFAULT,
          ),
          lowStockThreshold:
            merged.lowStockThreshold ?? LOW_STOCK_THRESHOLD_DEFAULT,
          prescriptionType: merged.prescriptionType ?? null,
          expiryDate: merged.expiryDate ? new Date(merged.expiryDate) : null,
        },
      });

      // Link primary and secondary categories
      const allCategoryIds = [
        ...(merged.primaryCategoryIds ?? []),
        ...(merged.secondaryCategoryIds ?? []),
      ];
      if (allCategoryIds.length) {
        await tx.drugCategoryMap.createMany({
          data: allCategoryIds.map((categoryId) => ({
            drugId: newDrug.id,
            categoryId,
          })),
          skipDuplicates: true,
        });
      }

      // Add indications
      if (merged.indications?.length) {
        await tx.drugIndication.createMany({
          data: merged.indications.map((indication) => ({
            drugId: newDrug.id,
            indication,
          })),
        });
      }

      // Add contraindications
      if (merged.contraindications?.length) {
        await tx.drugContraindication.createMany({
          data: merged.contraindications.map((contraindication) => ({
            drugId: newDrug.id,
            contraindication,
          })),
        });
      }

      return newDrug;
    });

    // Emit event for points / analytics
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { pharmacyId: true },
    });

    await this.eventBus.emit(EVENTS.INVENTORY.DRUG_ADDED, {
      drugId: drug.id,
      branchId,
      pharmacyId: branch?.pharmacyId ?? '',
      nafdacNumber: drug.nafdacNumber ?? undefined,
      drugName: drug.name,
      quantity: drug.stockAmount,
      addedAt: new Date(),
    });

    this.logger.log(`Drug added: ${drug.id} to branch ${branchId}`);
    return this.getDrugById(drug.id);
  }

  // ─── Get Drug Details ───────────────────────────────────────────────────────

  async getDrugById(drugId: string) {
    const drug = await this.prisma.drug.findUnique({
      where: { id: drugId },
      include: {
        categories: { include: { category: true } },
        indications: true,
        contraindications: true,
        images: { orderBy: { sortOrder: 'asc' } },
        alternatives: {
          include: { alternativeDrug: { select: { id: true, name: true, price: true, stockStatus: true } } },
        },
      },
    });

    if (!drug) throw new NotFoundException('Drug not found');
    return drug;
  }

  // ─── Alternatives ───────────────────────────────────────────────────────────

  async addAlternative(
    pharmacistUserId: string,
    drugId: string,
    alternativeDrugId: string,
  ) {
    if (drugId === alternativeDrugId) {
      throw new BadRequestException('A drug cannot be an alternative of itself');
    }

    const [drug, altDrug] = await Promise.all([
      this.prisma.drug.findUnique({ where: { id: drugId } }),
      this.prisma.drug.findUnique({ where: { id: alternativeDrugId } }),
    ]);

    if (!drug) throw new NotFoundException('Drug not found');
    if (!altDrug) throw new NotFoundException('Alternative drug not found');

    await this.assertBranchAccess(pharmacistUserId, drug.branchId);

    // Bidirectional upsert
    await this.prisma.drugAlternative.createMany({
      data: [
        { drugId, alternativeDrugId },
        { drugId: alternativeDrugId, alternativeDrugId: drugId },
      ],
      skipDuplicates: true,
    });

    return this.getDrugById(drugId);
  }

  async removeAlternative(
    pharmacistUserId: string,
    drugId: string,
    alternativeDrugId: string,
  ) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');

    await this.assertBranchAccess(pharmacistUserId, drug.branchId);

    // Bidirectional delete
    await this.prisma.drugAlternative.deleteMany({
      where: {
        OR: [
          { drugId, alternativeDrugId },
          { drugId: alternativeDrugId, alternativeDrugId: drugId },
        ],
      },
    });

    return this.getDrugById(drugId);
  }

  // ─── Update Drug ────────────────────────────────────────────────────────────

  async updateDrug(
    pharmacistUserId: string,
    drugId: string,
    dto: UpdateDrugDto,
  ) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');

    await this.assertBranchAccess(pharmacistUserId, drug.branchId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedDrug = await tx.drug.update({
        where: { id: drugId },
        data: {
          ...(dto.nafdacNumber !== undefined && { nafdacNumber: dto.nafdacNumber }),
          ...(dto.name && { name: dto.name }),
          ...(dto.genericName !== undefined && { genericName: dto.genericName }),
          ...(dto.aliasName !== undefined && { aliasName: dto.aliasName }),
          ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer }),
          ...(dto.composition !== undefined && { composition: dto.composition }),
          ...(dto.drugType && { drugType: dto.drugType }),
          ...(dto.packageType !== undefined && { packageType: dto.packageType }),
          ...(dto.adultDosage !== undefined && { adultDosage: dto.adultDosage }),
          ...(dto.childrenDosage !== undefined && { childrenDosage: dto.childrenDosage }),
          ...(dto.price !== undefined && { price: dto.price }),
          ...(dto.lowStockThreshold !== undefined && {
            lowStockThreshold: dto.lowStockThreshold,
          }),
          ...(dto.prescriptionType !== undefined && {
            prescriptionType: dto.prescriptionType ?? null,
          }),
          ...(dto.expiryDate !== undefined && {
            expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          }),
        },
      });

      // Replace categories if either list is provided
      if (dto.primaryCategoryIds !== undefined || dto.secondaryCategoryIds !== undefined) {
        await tx.drugCategoryMap.deleteMany({ where: { drugId } });
        const allCategoryIds = [
          ...(dto.primaryCategoryIds ?? []),
          ...(dto.secondaryCategoryIds ?? []),
        ];
        if (allCategoryIds.length) {
          await tx.drugCategoryMap.createMany({
            data: allCategoryIds.map((categoryId) => ({ drugId, categoryId })),
          });
        }
      }

      // Replace indications if provided
      if (dto.indications !== undefined) {
        await tx.drugIndication.deleteMany({ where: { drugId } });
        if (dto.indications.length) {
          await tx.drugIndication.createMany({
            data: dto.indications.map((indication) => ({ drugId, indication })),
          });
        }
      }

      // Replace contraindications if provided
      if (dto.contraindications !== undefined) {
        await tx.drugContraindication.deleteMany({ where: { drugId } });
        if (dto.contraindications.length) {
          await tx.drugContraindication.createMany({
            data: dto.contraindications.map((contraindication) => ({ drugId, contraindication })),
          });
        }
      }

      return updatedDrug;
    });

    await this.eventBus.emit(EVENTS.INVENTORY.DRUG_UPDATED, {
      drugId,
      branchId: drug.branchId,
      pharmacyId: '',
      drugName: updated.name,
      quantity: updated.stockAmount,
      addedAt: new Date(),
    });

    return this.getDrugById(drugId);
  }

  // ─── Remove Drug ────────────────────────────────────────────────────────────

  async removeDrug(pharmacistUserId: string, drugId: string) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');

    await this.assertBranchAccess(pharmacistUserId, drug.branchId);

    await this.prisma.drug.delete({ where: { id: drugId } });

    await this.eventBus.emit(EVENTS.INVENTORY.DRUG_REMOVED, {
      drugId,
      branchId: drug.branchId,
      pharmacyId: '',
      drugName: drug.name,
      quantity: drug.stockAmount,
      addedAt: new Date(),
    });

    return { message: 'Drug removed from inventory' };
  }

  // ─── Update Stock ───────────────────────────────────────────────────────────

  async updateStock(
    pharmacistUserId: string,
    drugId: string,
    dto: UpdateStockDto,
  ) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');

    await this.assertBranchAccess(pharmacistUserId, drug.branchId);

    const previousQuantity = drug.stockAmount;
    let newQuantity: number;

    switch (dto.mode) {
      case StockUpdateMode.SET:
        newQuantity = dto.quantity;
        break;
      case StockUpdateMode.ADD:
        newQuantity = previousQuantity + dto.quantity;
        break;
      case StockUpdateMode.SUBTRACT:
        newQuantity = Math.max(0, previousQuantity - dto.quantity);
        break;
    }

    const newStatus = this.computeStockStatus(
      newQuantity,
      drug.lowStockThreshold,
    );

    const updated = await this.prisma.drug.update({
      where: { id: drugId },
      data: { stockAmount: newQuantity, stockStatus: newStatus },
    });

    // Get pharmacy context for events
    const branch = await this.prisma.branch.findUnique({
      where: { id: drug.branchId },
      select: { pharmacyId: true },
    });
    const pharmacyId = branch?.pharmacyId ?? '';

    await this.eventBus.emit(EVENTS.INVENTORY.STOCK_UPDATED, {
      drugId,
      branchId: drug.branchId,
      pharmacyId,
      previousQuantity,
      newQuantity,
      updatedAt: new Date(),
    });

    // Fire specific low-stock / out-of-stock events
    if (newQuantity === 0 && previousQuantity > 0) {
      await this.eventBus.emit(EVENTS.INVENTORY.STOCK_OUT, {
        drugId,
        branchId: drug.branchId,
        pharmacyId,
        pharmacistUserId,
        affectedReservationIds: [],
      });
    } else if (
      newQuantity <= drug.lowStockThreshold &&
      previousQuantity > drug.lowStockThreshold
    ) {
      await this.eventBus.emit(EVENTS.INVENTORY.STOCK_LOW, {
        drugId,
        branchId: drug.branchId,
        pharmacyId,
        pharmacistUserId,
        currentQuantity: newQuantity,
        threshold: drug.lowStockThreshold,
      });
    }

    return updated;
  }

  // ─── List Inventory ─────────────────────────────────────────────────────────

  async listInventory(
    pharmacistUserId: string,
    branchId: string,
    query: InventoryQueryDto,
  ) {
    await this.assertBranchAccess(pharmacistUserId, branchId);
    return this.queryInventory(branchId, query);
  }

  /** Public read — for search results / drug detail pages */
  async listInventoryPublic(branchId: string, query: InventoryQueryDto) {
    return this.queryInventory(branchId, query);
  }

  private async queryInventory(branchId: string, query: InventoryQueryDto) {
    const now = new Date();

    const where: Prisma.DrugWhereInput = {
      branchId,
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { genericName: { contains: query.search, mode: 'insensitive' } },
          { aliasName: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
      ...(query.stockStatus && { stockStatus: query.stockStatus }),
      ...(query.prescriptionType && {
        prescriptionType: query.prescriptionType,
      }),
      ...(!query.includeExpired && {
        OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
      }),
      ...(query.categoryId && {
        categories: { some: { categoryId: query.categoryId } },
      }),
    };

    const [total, drugs] = await Promise.all([
      this.prisma.drug.count({ where }),
      this.prisma.drug.findMany({
        where,
        include: {
          categories: { include: { category: { select: { id: true, name: true } } } },
          images: { where: { sortOrder: 0 }, take: 1 },
        },
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
    ]);

    const limit = query.limit ?? 20;
    const page = query.page ?? 1;

    return {
      data: drugs,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  // ─── Inventory Summary / Dashboard ─────────────────────────────────────────

  async getInventorySummary(pharmacistUserId: string, branchId: string) {
    await this.assertBranchAccess(pharmacistUserId, branchId);

    const [total, inStock, lowStock, outOfStock, expiringSoon] =
      await Promise.all([
        this.prisma.drug.count({ where: { branchId } }),
        this.prisma.drug.count({ where: { branchId, stockStatus: 'in_stock' } }),
        this.prisma.drug.count({ where: { branchId, stockStatus: 'low_stock' } }),
        this.prisma.drug.count({
          where: { branchId, stockStatus: 'out_of_stock' },
        }),
        this.prisma.drug.count({
          where: {
            branchId,
            expiryDate: {
              gte: new Date(),
              lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            },
          },
        }),
      ]);

    return { total, inStock, lowStock, outOfStock, expiringSoon };
  }

  // ─── Drug Image Upload ──────────────────────────────────────────────────────

  async uploadDrugImage(
    pharmacistUserId: string,
    drugId: string,
    file: Express.Multer.File,
  ) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');

    await this.assertBranchAccess(pharmacistUserId, drug.branchId);

    const imageCount = await this.prisma.drugImage.count({ where: { drugId } });
    if (imageCount >= 5) {
      throw new BadRequestException('Maximum of 5 images per drug');
    }

    const result = await this.cloudinary.uploadImage(
      file.buffer,
      `drugs/${drugId}`,
    );

    return this.prisma.drugImage.create({
      data: {
        drugId,
        url: result.url,
        cloudinaryId: result.publicId,
        sortOrder: imageCount,
      },
    });
  }

  async deleteDrugImage(
    pharmacistUserId: string,
    drugId: string,
    imageId: string,
  ) {
    const drug = await this.prisma.drug.findUnique({ where: { id: drugId } });
    if (!drug) throw new NotFoundException('Drug not found');

    await this.assertBranchAccess(pharmacistUserId, drug.branchId);

    const image = await this.prisma.drugImage.findFirst({
      where: { id: imageId, drugId },
    });
    if (!image) throw new NotFoundException('Image not found');

    if (image.cloudinaryId) {
      await this.cloudinary.deleteImage(image.cloudinaryId);
    }

    await this.prisma.drugImage.delete({ where: { id: imageId } });
    return { message: 'Image deleted' };
  }

  // ─── Access Control Helpers ─────────────────────────────────────────────────

  /**
   * Returns true if the user is: the pharmacy owner, a pharmacist operator,
   * or a staff member assigned to this branch.
   */
  private async assertBranchAccess(
    userId: string,
    branchId: string,
  ): Promise<void> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { pharmacyId: true },
    });

    if (!branch) throw new NotFoundException('Branch not found');

    const pharmacyId = branch.pharmacyId;

    // 1. Check PharmacistProfile (owner / operator)
    const pharmacistProfile = await this.prisma.pharmacistProfile.findFirst({
      where: {
        userId,
        pharmacyId,
        roleInPharmacy: { in: ['owner', 'operator'] },
      },
    });
    if (pharmacistProfile) return;

    // 2. Check PharmacyStaff (operator or staff assigned to this branch or pharmacy-wide)
    const staffMembership = await this.prisma.pharmacyStaff.findFirst({
      where: {
        userId,
        pharmacyId,
        isActive: true,
        OR: [
          { branchId: branchId },  // branch-specific staff
          { branchId: null },      // pharmacy-wide staff
        ],
      },
    });
    if (staffMembership) return;

    throw new ForbiddenException(
      'You do not have permission to manage inventory for this branch',
    );
  }

  // ─── Batch Upload ───────────────────────────────────────────────────────────

  async initiateBatchUpload(
    pharmacistUserId: string,
    branchId: string,
    file: Express.Multer.File,
  ) {
    // 1. Assert pharmacist-level access (owner / operator only — no staff)
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { pharmacyId: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const pharmacistProfile = await this.prisma.pharmacistProfile.findFirst({
      where: {
        userId: pharmacistUserId,
        pharmacyId: branch.pharmacyId,
        roleInPharmacy: { in: ['owner', 'operator'] },
      },
    });
    if (!pharmacistProfile) {
      throw new ForbiddenException(
        'Only pharmacy owners or operators can perform batch uploads',
      );
    }

    // 2. Upload CSV to object storage (R2) for the processor to fetch later
    const fileUrl = await this.storage.upload(
      file.buffer,
      file.mimetype,
      `batch-uploads/${branchId}`,
      `${Date.now()}.csv`,
    );

    // 3. Create a BatchUploadJob record for progress tracking
    const batchJob = await this.prisma.batchUploadJob.create({
      data: {
        branchId,
        fileUrl,
        status: 'pending',
        totalRows: 0,
        addedCount: 0,
        errorCount: 0,
      },
    });

    // 4. Enqueue the job — pass the DB record ID so the processor can update it
    await this.batchQueue.add('process', {
      jobId: batchJob.id,
      pharmacyId: branch.pharmacyId,
      branchId,
      fileUrl,
      totalRows: 0,
      startedAt: new Date(),
    });

    this.logger.log(
      `Batch upload queued — jobId: ${batchJob.id}, branch: ${branchId}`,
    );

    return {
      message: 'Batch upload queued successfully',
      jobId: batchJob.id,
      fileUrl,
    };
  }

  // ─── Drug Categories (public) ───────────────────────────────────────────────

  async listCategories(type?: 'primary' | 'secondary') {
    const categories = await this.prisma.drugCategory.findMany({
      where: { isActive: true, ...(type ? { type } : {}) },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, type: true, name: true, slug: true, description: true, sortOrder: true },
    });

    // Group by type for convenience
    return {
      primary: categories.filter((c) => c.type === 'primary'),
      secondary: categories.filter((c) => c.type === 'secondary'),
    };
  }

  // ─── Stock Status Computation ───────────────────────────────────────────────

  private computeStockStatus(
    quantity: number,
    threshold: number,
  ): 'in_stock' | 'low_stock' | 'out_of_stock' {
    if (quantity === 0) return 'out_of_stock';
    if (quantity <= threshold) return 'low_stock';
    return 'in_stock';
  }
}
