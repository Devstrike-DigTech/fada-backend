import { Global, Module } from '@nestjs/common';
import { PcnRegistryService } from './pcn-registry.service';
import { CacRegistryService } from './cac-registry.service';

@Global()
@Module({
  providers: [PcnRegistryService, CacRegistryService],
  exports: [PcnRegistryService, CacRegistryService],
})
export class RegistriesModule {}
