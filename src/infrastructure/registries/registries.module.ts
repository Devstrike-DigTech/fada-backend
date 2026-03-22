import { Global, Module } from '@nestjs/common';
import { PcnRegistryService } from './pcn-registry.service';

@Global()
@Module({
  providers: [PcnRegistryService],
  exports: [PcnRegistryService],
})
export class RegistriesModule {}
