// ─── Provider-agnostic drug lookup contract ──────────────────────────────────

export interface DrugLookupResult {
  found: boolean;
  nafdacNumber?: string;
  name?: string;
  genericName?: string;
  manufacturer?: string;
  composition?: string;
  drugType?: string;
  packageType?: string;
  /** Raw provider payload preserved for audit / future enrichment */
  rawData?: Record<string, unknown>;
}

/**
 * IDrugInfoProvider — implement this interface to plug in any drug-info
 * registry (EMDEX, NAFDAC direct scrape, another data vendor, or a mock).
 *
 * Register your implementation with the DI token DRUG_INFO_PROVIDER.
 */
export interface IDrugInfoProvider {
  lookupByNafdacNumber(nafdacNumber: string): Promise<DrugLookupResult>;
  lookupByName(name: string): Promise<DrugLookupResult[]>;
}

export const DRUG_INFO_PROVIDER = Symbol('DRUG_INFO_PROVIDER');
