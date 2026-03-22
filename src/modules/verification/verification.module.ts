import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { PcnVerificationListener } from './pcn-verification.listener';
import { PcnVerificationProcessor } from './pcn-verification.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.VERIFICATION_PCN }),
  ],
  providers: [PcnVerificationListener, PcnVerificationProcessor],
})
export class VerificationModule {}
