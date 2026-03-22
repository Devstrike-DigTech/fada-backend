import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DrugLookupResult,
  IDrugInfoProvider,
} from './drug-info.interface';

/**
 * EMDEX Drug Info Provider
 *
 * EMDEX (https://emdex.com.ng) is a Nigerian drug database that wraps
 * NAFDAC-registered products with enriched clinical data.
 *
 * Env vars:
 *   EMDEX_API_URL   - Base URL (e.g. https://api.emdex.com.ng/v1)
 *   EMDEX_API_KEY   - Bearer token / API key from your EMDEX account
 *
 * When either env var is absent the service falls back to MOCK mode so
 * local development always works without a subscription.
 *
 * To switch providers in the future, create a new class that implements
 * IDrugInfoProvider and swap the provider binding in NafdacModule.
 */
@Injectable()
export class EmdexService implements IDrugInfoProvider {
  private readonly logger = new Logger(EmdexService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly isMock: boolean;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      configService.get<string>('nafdac.emdex.apiUrl') ??
      process.env.EMDEX_API_URL ??
      '';
    this.apiKey =
      configService.get<string>('nafdac.emdex.apiKey') ??
      process.env.EMDEX_API_KEY ??
      '';
    this.isMock = !this.baseUrl || !this.apiKey;

    if (this.isMock) {
      this.logger.warn(
        'EMDEX_API_URL or EMDEX_API_KEY not set — drug lookup running in MOCK mode.',
      );
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async lookupByNafdacNumber(nafdacNumber: string): Promise<DrugLookupResult> {
    const normalised = this.normaliseNafdacNumber(nafdacNumber);

    if (this.isMock) {
      return this.mockLookupByNafdac(normalised);
    }

    return this.realLookupByNafdac(normalised);
  }

  async lookupByName(name: string): Promise<DrugLookupResult[]> {
    if (this.isMock) {
      return this.mockSearchByName(name);
    }

    return this.realSearchByName(name);
  }

  // ─── Real EMDEX integration ──────────────────────────────────────────────────

  private async realLookupByNafdac(
    nafdacNumber: string,
  ): Promise<DrugLookupResult> {
    try {
      const res = await fetch(
        `${this.baseUrl}/drugs/nafdac/${encodeURIComponent(nafdacNumber)}`,
        {
          headers: this.headers(),
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (res.status === 404) {
        return { found: false };
      }

      if (!res.ok) {
        throw new Error(`EMDEX returned HTTP ${res.status}`);
      }

      const json = (await res.json()) as EmdexDrugResponse;
      return this.mapEmdexResponse(json);
    } catch (err) {
      this.logger.error(`EMDEX nafdac lookup failed: ${String(err)}`);
      return { found: false };
    }
  }

  private async realSearchByName(name: string): Promise<DrugLookupResult[]> {
    try {
      const res = await fetch(
        `${this.baseUrl}/drugs/search?q=${encodeURIComponent(name)}&limit=10`,
        {
          headers: this.headers(),
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!res.ok) {
        throw new Error(`EMDEX search returned HTTP ${res.status}`);
      }

      const json = (await res.json()) as { data: EmdexDrugResponse[] };
      return (json.data ?? []).map((item) => this.mapEmdexResponse(item));
    } catch (err) {
      this.logger.error(`EMDEX name search failed: ${String(err)}`);
      return [];
    }
  }

  // ─── Mapping ─────────────────────────────────────────────────────────────────

  private mapEmdexResponse(raw: EmdexDrugResponse): DrugLookupResult {
    return {
      found: true,
      nafdacNumber: raw.nafdac_number ?? raw.nafdacNumber,
      name: raw.brand_name ?? raw.brandName ?? raw.name,
      genericName: raw.generic_name ?? raw.genericName,
      manufacturer: raw.manufacturer ?? raw.manufacturer_name,
      composition: raw.composition ?? raw.active_ingredients,
      drugType: raw.drug_type ?? raw.dosage_form,
      packageType: raw.pack_type ?? raw.package_size,
      rawData: raw as unknown as Record<string, unknown>,
    };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private normaliseNafdacNumber(raw: string): string {
    // Remove common prefixes: "NAFDAC/", "A4-", spaces, etc.
    return raw.replace(/^(NAFDAC\/?)/i, '').trim();
  }

  // ─── Mock data (dev / offline) ────────────────────────────────────────────────

  private mockLookupByNafdac(nafdacNumber: string): DrugLookupResult {
    this.logger.debug(`[MOCK] NAFDAC lookup: ${nafdacNumber}`);

    const MOCK_DB: Record<string, Partial<DrugLookupResult>> = {
      A4100019: {
        name: 'Paracetamol Tablets 500mg',
        genericName: 'Paracetamol',
        manufacturer: 'Emzor Pharmaceutical Industries Ltd',
        composition: 'Paracetamol 500mg',
        drugType: 'oral',
        packageType: 'Tablet',
      },
      B3200048: {
        name: 'Amoxicillin Capsules 250mg',
        genericName: 'Amoxicillin',
        manufacturer: 'Fidson Healthcare Plc',
        composition: 'Amoxicillin trihydrate equivalent to 250mg Amoxicillin',
        drugType: 'oral',
        packageType: 'Capsule',
      },
      A4150110: {
        name: 'Metronidazole Tablets 200mg',
        genericName: 'Metronidazole',
        manufacturer: 'May & Baker Nigeria Plc',
        composition: 'Metronidazole 200mg',
        drugType: 'oral',
        packageType: 'Tablet',
      },
    };

    const found = MOCK_DB[nafdacNumber];
    if (!found) {
      // In mock mode, return a generic result for any unknown number
      return {
        found: true,
        nafdacNumber,
        name: `Mock Drug (${nafdacNumber})`,
        genericName: 'Generic substance',
        manufacturer: 'Test Pharma Ltd',
        composition: 'Active ingredient 100mg',
        drugType: 'oral',
        packageType: 'Tablet',
        rawData: { mock: true },
      };
    }

    return { found: true, nafdacNumber, ...found, rawData: { mock: true } };
  }

  private mockSearchByName(name: string): DrugLookupResult[] {
    this.logger.debug(`[MOCK] NAFDAC search by name: ${name}`);

    return [
      {
        found: true,
        nafdacNumber: 'A4100019',
        name: `${name} Tablets 500mg`,
        genericName: name,
        manufacturer: 'Emzor Pharmaceutical Industries Ltd',
        composition: `${name} 500mg`,
        drugType: 'oral',
        packageType: 'Tablet',
        rawData: { mock: true },
      },
    ];
  }
}

// ─── EMDEX response shape (camelCase and snake_case variants) ──────────────────

interface EmdexDrugResponse {
  nafdac_number?: string;
  nafdacNumber?: string;
  brand_name?: string;
  brandName?: string;
  name?: string;
  generic_name?: string;
  genericName?: string;
  manufacturer?: string;
  manufacturer_name?: string;
  composition?: string;
  active_ingredients?: string;
  drug_type?: string;
  dosage_form?: string;
  pack_type?: string;
  package_size?: string;
  [key: string]: unknown;
}
