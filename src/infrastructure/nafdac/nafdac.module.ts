import { Global, Module } from '@nestjs/common';
import { EmdexService } from './emdex.service';
import { DRUG_INFO_PROVIDER } from './drug-info.interface';

/**
 * NafdacModule — provides the active IDrugInfoProvider globally.
 *
 * To switch providers:
 *   1. Implement IDrugInfoProvider in a new service
 *   2. Replace `useClass: EmdexService` below with your new service
 *   3. Add the new service to `providers` array
 *
 * A fallback chain (primary → secondary) can be implemented by wrapping
 * both providers in a FallbackDrugInfoService that catches errors from
 * the primary and delegates to the secondary.
 */
@Global()
@Module({
  providers: [
    EmdexService,
    {
      provide: DRUG_INFO_PROVIDER,
      useExisting: EmdexService,
    },
  ],
  exports: [DRUG_INFO_PROVIDER, EmdexService],
})
export class NafdacModule {}
