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
import { EVENTS, BatchUploadStartedPayload } from '@common/types/events.types';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';

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
    @Inject(DRUG_INFO_PROVIDER)
    private readonly drugInfoProvider: IDrugInfoProvider,
  ) {}

  @Process('process')
  async processBatchUpload(
    job: Job<BatchUploadStartedPayload & { jobId: string }>,
  ): Promise<void> {
    const { jobId, branchId, fileUrl } = job.data;

    this.logger.log(`Processing batch upload job ${jobId} for branch ${branchId}`);

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
      this.logger.error(`Batch upload ${jobId}: file fetch/parse failed — ${String(err)}`);
      await this.prisma.batchUploadJob.update({
        where: { id: jobId },
        data: { status: 'failed', errorRows: [{ message: String(err) }] as unknown as Prisma.InputJsonValue },
      });
      return;
    }

    // ── 2. Process rows ───────────────────────────────────────────────────────
    let addedCount = 0;
    let errorCount = 0;
    const errorRows: RowError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 because row 1 is the header

      try {
        await this.processRow(row, branchId);
        addedCount++;

        // Update progress every 10 rows
        if (addedCount % 10 === 0) {
          await job.progress(Math.round((i / rows.length) * 100));
          await this.prisma.batchUploadJob.update({
            where: { id: jobId },
            data: { addedCount },
          });
        }
      } catch (err) {
        errorCount++;
        errorRows.push({
          row: rowNumber,
          message: err instanceof Error ? err.message : String(err),
        });
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

    // ── 4. Emit completion event ──────────────────────────────────────────────
    await this.eventBus.emit(EVENTS.INVENTORY.BATCH_UPLOAD_COMPLETED, {
      jobId,
      pharmacyId: job.data.pharmacyId,
      branchId,
      successCount: addedCount,
      failureCount: errorCount,
      completedAt: new Date(),
    });
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

    const validPrescriptionTypes = ['otc', 'prescription_only', 'controlled'] as const;
    type PT = typeof validPrescriptionTypes[number];
    const raw = row.prescriptionType?.trim().toLowerCase().replace(/[- ]/g, '_');
    const prescriptionType: PT | null = validPrescriptionTypes.includes(raw as PT)
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
        stockStatus: stockStatus as 'in_stock' | 'low_stock' | 'out_of_stock',
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
        price: obj['price'] || '0',
        stockAmount: obj['stock_amount'] || obj['stockamount'] || '0',
        lowStockThreshold: obj['low_stock_threshold'] || obj['lowstockthreshold'],
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
