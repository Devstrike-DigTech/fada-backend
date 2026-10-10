import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { StorageService } from '@infra/storage/storage.service';
import {
  DRUG_INFO_PROVIDER,
  IDrugInfoProvider,
} from '@infra/nafdac/drug-info.interface';
import {
  EVENTS,
  BatchUploadProgressPayload,
  BatchUploadStartedPayload,
} from '@common/types/events.types';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { SubscriptionEntitlementsService } from '@modules/subscription/subscription-entitlements.service';

interface BatchRow {
  nafdacNumber?: string;
  name: string;
  genericName?: string;
  manufacturer?: string;
  drugType?: string;
  packageType?: string;
  price: string | number;
  stockAmount: string | number;
  lowStockThreshold?: string | number;
  expiryDate?: string;
  prescriptionType?: string;
}

interface RowError {
  row: number;
  field?: string;
  message: string;
}

@Processor(QUEUE_NAMES.INVENTORY_BATCH_UPLOAD)
export class BatchUploadProcessor {
  private readonly logger = new Logger(BatchUploadProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly storage: StorageService,
    private readonly entitlements: SubscriptionEntitlementsService,
    @Inject(DRUG_INFO_PROVIDER)
    private readonly drugInfoProvider: IDrugInfoProvider,
  ) {}

  @Process('process')
  async processBatchUpload(
    job: Job<BatchUploadStartedPayload & { jobId: string }>,
  ): Promise<void> {
    const { jobId, branchId, fileUrl } = job.data;

    this.logger.log(
      `Processing batch upload job ${jobId} for branch ${branchId}`,
    );

    await this.prisma.batchUploadJob.update({
      where: { id: jobId },
      data: { status: 'processing' },
    });

    let rows: BatchRow[] = [];

    // ── 1. Fetch & parse the CSV from R2 ─────────────────────────────────────
    try {
      const response = await fetch(fileUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch file: HTTP ${response.status}`);
      }
      const text = await response.text();
      rows = this.parseCsv(text);
    } catch (err) {
      this.logger.error(
        `Batch upload ${jobId}: file fetch/parse failed — ${String(err)}`,
      );
      await this.prisma.batchUploadJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorRows: [
            { message: String(err) },
          ] as unknown as Prisma.InputJsonValue,
        },
      });
      this.emitProgress(
        job.data,
        'failed',
        0,
        0,
        0,
        0,
        'The file could not be read. Check it is a valid CSV.',
      );
      this.eventBus.emit(EVENTS.INVENTORY.BATCH_UPLOAD_FAILED, {
        jobId,
        pharmacyId: job.data.pharmacyId,
        branchId,
        successCount: 0,
        failureCount: 0,
        completedAt: new Date(),
      });
      return;
    }

    await this.prisma.batchUploadJob.update({
      where: { id: jobId },
      data: { totalRows: rows.length },
    });
    this.emitProgress(job.data, 'processing', 0, rows.length, 0, 0);
    // Stream progress about every 2 % (at least every 10 rows)
    const progressEvery = Math.max(10, Math.ceil(rows.length / 50));

    // ── 2. Process rows ───────────────────────────────────────────────────────
    let addedCount = 0;
    let errorCount = 0;
    const errorRows: RowError[] = [];

    // Plan limit: a bulk upload may not exceed the pharmacy's inventory slots
    const ent = await this.entitlements.getEntitlements(job.data.pharmacyId);
    const usage = await this.entitlements.getUsage(job.data.pharmacyId);
    let slotsLeft = Math.max(
      0,
      ent.inventorySlotLimit - usage.inventorySlotsUsed,
    );

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 because row 1 is the header

      try {
        if (slotsLeft <= 0) {
          throw new Error(
            `Inventory limit reached for the ${ent.planName} plan (${ent.inventorySlotLimit} drugs). Upgrade to add more.`,
          );
        }
        await this.processRow(row, branchId);
        slotsLeft--;
        addedCount++;
      } catch (err) {
        errorCount++;
        errorRows.push({
          row: rowNumber,
          message: err instanceof Error ? err.message : String(err),
        });
      }

      const processed = i + 1;
      if (processed % progressEvery === 0 && processed < rows.length) {
        await job.progress(Math.round((processed / rows.length) * 100));
        await this.prisma.batchUploadJob.update({
          where: { id: jobId },
          data: { addedCount, errorCount },
        });
        this.emitProgress(
          job.data,
          'processing',
          processed,
          rows.length,
          addedCount,
          errorCount,
        );
      }
    }

    // ── 3. Finalize ───────────────────────────────────────────────────────────
    const finalStatus =
      errorCount === 0
        ? 'completed'
        : addedCount === 0
          ? 'failed'
          : 'completed_with_errors';

    await this.prisma.batchUploadJob.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        totalRows: rows.length,
        addedCount,
        errorCount,
        errorRows: errorRows as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Batch upload ${jobId} done — added: ${addedCount}, errors: ${errorCount}`,
    );

    this.emitProgress(
      job.data,
      finalStatus,
      rows.length,
      rows.length,
      addedCount,
      errorCount,
    );

    // ── 4. Emit completion event ──────────────────────────────────────────────
    this.eventBus.emit(EVENTS.INVENTORY.BATCH_UPLOAD_COMPLETED, {
      jobId,
      pharmacyId: job.data.pharmacyId,
      branchId,
      successCount: addedCount,
      failureCount: errorCount,
      completedAt: new Date(),
    });
  }

  private emitProgress(
    data: { jobId: string; pharmacyId: string; branchId: string },
    status: BatchUploadProgressPayload['status'],
    processed: number,
    total: number,
    added: number,
    errors: number,
    message?: string,
  ): void {
    const payload: BatchUploadProgressPayload = {
      jobId: data.jobId,
      pharmacyId: data.pharmacyId,
      branchId: data.branchId,
      status,
      processed,
      total,
      added,
      errors,
      percent:
        total > 0
          ? Math.round((processed / total) * 100)
          : status === 'processing'
            ? 0
            : 100,
      message,
    };
    this.eventBus.emit(EVENTS.INVENTORY.BATCH_UPLOAD_PROGRESS, payload);
  }

  // ─── Row processor ────────────────────────────────────────────────────────────

  private async processRow(row: BatchRow, branchId: string): Promise<void> {
    // Validate required fields
    if (!row.name?.trim()) {
      throw new Error('Missing required field: name');
    }
    const price = parseFloat(String(row.price));
    if (isNaN(price) || price < 0) {
      throw new Error(`Invalid price: "${row.price}"`);
    }
    const stockAmount = parseInt(String(row.stockAmount), 10);
    if (isNaN(stockAmount) || stockAmount < 0) {
      throw new Error(`Invalid stockAmount: "${row.stockAmount}"`);
    }

    // Auto-enrich from EMDEX if NAFDAC number is present
    let enrichedName = row.name.trim();
    let enrichedManufacturer = row.manufacturer;
    let enrichedComposition: string | undefined;
    let enrichedDrugType = row.drugType;

    if (row.nafdacNumber?.trim()) {
      try {
        const lookup = await this.drugInfoProvider.lookupByNafdacNumber(
          row.nafdacNumber.trim(),
        );
        if (lookup.found) {
          enrichedName = lookup.name ?? enrichedName;
          enrichedManufacturer = lookup.manufacturer ?? enrichedManufacturer;
          enrichedComposition = lookup.composition;
          enrichedDrugType = lookup.drugType ?? enrichedDrugType;
        }
      } catch {
        // Non-fatal — continue with provided data
      }
    }

    const validPrescriptionTypes = [
      'otc',
      'prescription_only',
      'controlled',
    ] as const;
    type PT = (typeof validPrescriptionTypes)[number];
    const raw = row.prescriptionType
      ?.trim()
      .toLowerCase()
      .replace(/[- ]/g, '_');
    const prescriptionType: PT | null = validPrescriptionTypes.includes(
      raw as PT,
    )
      ? (raw as PT)
      : null;

    const lowStockThreshold = row.lowStockThreshold
      ? parseInt(String(row.lowStockThreshold), 10)
      : 5;

    const expiryDate =
      row.expiryDate && row.expiryDate.trim()
        ? new Date(row.expiryDate.trim())
        : null;

    if (expiryDate && isNaN(expiryDate.getTime())) {
      throw new Error(`Invalid expiryDate: "${row.expiryDate}"`);
    }

    const stockStatus =
      stockAmount === 0
        ? 'out_of_stock'
        : stockAmount <= lowStockThreshold
          ? 'low_stock'
          : 'in_stock';

    await this.prisma.drug.create({
      data: {
        branchId,
        nafdacNumber: row.nafdacNumber?.trim() || null,
        nafdacVerified: !!row.nafdacNumber?.trim(),
        name: enrichedName,
        genericName: row.genericName?.trim() || null,
        manufacturer: enrichedManufacturer?.trim() || null,
        composition: enrichedComposition || null,
        drugType: (enrichedDrugType ?? 'oral') as
          | 'oral'
          | 'infusion'
          | 'injectable'
          | 'antiseptic'
          | 'other',
        packageType: row.packageType?.trim() || null,
        price,
        stockAmount,
        stockStatus: stockStatus,
        lowStockThreshold,
        prescriptionType,
        expiryDate,
      },
    });
  }

  // ─── CSV parser (no external dependency) ─────────────────────────────────────

  private parseCsv(text: string): BatchRow[] {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];

    const headers = this.parseCsvLine(lines[0]).map((h) =>
      h.trim().toLowerCase().replace(/\s+/g, '_'),
    );

    const rows: BatchRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = this.parseCsvLine(line);
      const obj: Record<string, string> = {};

      headers.forEach((header, idx) => {
        obj[header] = (values[idx] ?? '').trim();
      });

      rows.push({
        nafdacNumber: obj['nafdac_number'] || obj['nafdacnumber'],
        name: obj['name'] || obj['drug_name'],
        genericName: obj['generic_name'] || obj['genericname'],
        manufacturer: obj['manufacturer'],
        drugType: obj['drug_type'] || obj['drugtype'],
        packageType: obj['package_type'] || obj['packagetype'],
        // No default: a blank price must be reported, not listed as free
        price: obj['price'] ?? '',
        stockAmount: obj['stock_amount'] || obj['stockamount'] || '0',
        lowStockThreshold:
          obj['low_stock_threshold'] || obj['lowstockthreshold'],
        expiryDate: obj['expiry_date'] || obj['expirydate'],
        prescriptionType: obj['prescription_type'] || obj['prescriptiontype'],
      });
    }

    return rows;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }
}
