import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { PcnVerificationListener } from './pcn-verification.listener';
import { PcnVerificationProcessor } from './pcn-verification.processor';
import { CacVerificationListener } from './cac-verification.listener';
import { CacVerificationProcessor } from './cac-verification.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.VERIFICATION_PCN }),
    BullModule.registerQueue({ name: QUEUE_NAMES.VERIFICATION_CAC }),
  ],
  providers: [
    PcnVerificationListener,
    PcnVerificationProcessor,
    CacVerificationListener,
    CacVerificationProcessor,
  ],
})
export class VerificationModule {}
