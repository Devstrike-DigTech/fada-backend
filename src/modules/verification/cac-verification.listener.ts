import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EVENTS, CacVerificationRequestedPayload } from '@common/types/events.types';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';

@Injectable()
export class CacVerificationListener {
  private readonly logger = new Logger(CacVerificationListener.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.VERIFICATION_CAC)
    private readonly cacQueue: Queue,
  ) {}

  @OnEvent(EVENTS.PHARMACY.CAC_VERIFICATION_REQUESTED, { async: true })
  async handleCacVerificationRequested(
    payload: CacVerificationRequestedPayload,
  ): Promise<void> {
    this.logger.log(
      `Queuing CAC verification for pharmacy ${payload.pharmacyId}, RC: ${payload.cacNumber}`,
    );

    await this.cacQueue.add('verify', payload, {
      jobId: `cac:${payload.pharmacyId}`,
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
    });
  }
}
