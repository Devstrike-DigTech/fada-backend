import { Injectable, Logger } from '@nestjs/common';

export interface PcnLookupResult {
  found: boolean;
  pharmacistId?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  regNumber?: string;
}

const PCN_API_URL =
  'https://pcncore.azurewebsites.net/PublicSearch/PharmacistLicence';

@Injectable()
export class PcnRegistryService {
  private readonly logger = new Logger(PcnRegistryService.name);

  async lookupLicense(licenseNumber: string): Promise<PcnLookupResult> {
    // Strip common prefixes (e.g. "PCN-022140" → "022140")
    const normalised = licenseNumber.replace(/^[A-Za-z]+-?/i, '').trim();

    this.logger.debug(`Looking up PCN license: ${normalised}`);

    const body = new URLSearchParams({
      sort: '',
      group: '',
      filter: '',
      LicenceFilter: normalised,
    });

    const response = await fetch(PCN_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`PCN registry returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as {
      Data: Array<{
        PharmacistId: string;
        FirstName: string;
        MiddleName: string;
        LastName: string;
        PharmacistRegNumber: string;
      }>;
      Total: number;
      Errors: unknown;
    };

    if (!json.Data || json.Total === 0) {
      return { found: false };
    }

    const match = json.Data[0];
    return {
      found: true,
      pharmacistId: match.PharmacistId,
      firstName: match.FirstName,
      middleName: match.MiddleName,
      lastName: match.LastName,
      regNumber: match.PharmacistRegNumber,
    };
  }
}
