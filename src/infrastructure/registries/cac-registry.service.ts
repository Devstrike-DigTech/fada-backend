import { Injectable, Logger } from '@nestjs/common';

export interface CacLookupResult {
  found: boolean;
  rcNumber?: string;
  companyName?: string;
  companyType?: string;
  status?: string;
  registrationDate?: string;
  address?: string;
}

/**
 * CAC Registry Service
 *
 * Integrates with Nigeria's Corporate Affairs Commission (CAC) public search.
 * The official CAC search portal is at https://search.cac.gov.ng
 *
 * NOTE: The CAC does not expose an official public JSON API.
 * This service is built to be swapped with a licensed data provider
 * (e.g. Dojah, Prembly, Smile Identity) when a paid integration is available.
 *
 * Current implementation uses a best-effort scrape/proxy approach.
 * Set CAC_API_URL + CAC_API_KEY in env to activate a real provider.
 */
@Injectable()
export class CacRegistryService {
  private readonly logger = new Logger(CacRegistryService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly useMock: boolean;

  constructor() {
    this.apiUrl = process.env.CAC_API_URL ?? '';
    this.apiKey = process.env.CAC_API_KEY ?? '';
    this.useMock = !this.apiUrl || !this.apiKey;

    if (this.useMock) {
      this.logger.warn(
        'CAC_API_URL or CAC_API_KEY not set — running in MOCK mode. Set env vars to enable real verification.',
      );
    }
  }

  async lookupCompany(rcNumber: string): Promise<CacLookupResult> {
    const normalised = rcNumber.replace(/^RC-?/i, '').trim();

    if (this.useMock) {
      return this.mockLookup(normalised);
    }

    return this.realLookup(normalised);
  }

  // ─── Real provider integration ───────────────────────────────────────────────

  private async realLookup(rcNumber: string): Promise<CacLookupResult> {
    this.logger.debug(`Looking up CAC RC number: ${rcNumber}`);

    try {
      const response = await fetch(`${this.apiUrl}/verify/cac`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ rc_number: rcNumber }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        this.logger.error(`CAC registry returned HTTP ${response.status}`);
        return { found: false };
      }

      // Generic response shape — adapt to your provider's actual payload
      const json = (await response.json()) as {
        status: boolean;
        data?: {
          rc_number?: string;
          company_name?: string;
          company_type?: string;
          status?: string;
          registration_date?: string;
          address?: string;
        };
      };

      if (!json.status || !json.data) {
        return { found: false };
      }

      const d = json.data;
      return {
        found: true,
        rcNumber: d.rc_number,
        companyName: d.company_name,
        companyType: d.company_type,
        status: d.status,
        registrationDate: d.registration_date,
        address: d.address,
      };
    } catch (err) {
      this.logger.error(`CAC lookup failed: ${String(err)}`);
      return { found: false };
    }
  }

  // ─── Mock for development ─────────────────────────────────────────────────────

  private mockLookup(rcNumber: string): CacLookupResult {
    this.logger.debug(`[MOCK] CAC lookup for RC: ${rcNumber}`);

    // Simulate network delay
    const fakeNames: Record<string, string> = {
      '123456': 'RxPlus Healthcare Limited',
      '654321': 'MediCare Pharmacy Nigeria Ltd',
    };

    const name = fakeNames[rcNumber];
    if (!name) {
      // For any other number, return as found in mock mode
      return {
        found: true,
        rcNumber,
        companyName: `Test Pharmacy RC${rcNumber} Ltd`,
        companyType: 'Private Company Limited by Shares',
        status: 'Active',
        registrationDate: '2010-05-20',
        address: '1 Test Street, Lagos, Nigeria',
      };
    }

    return {
      found: true,
      rcNumber,
      companyName: name,
      companyType: 'Private Company Limited by Shares',
      status: 'Active',
      registrationDate: '2015-03-10',
      address: '5 Sample Avenue, Lagos, Nigeria',
    };
  }
}
