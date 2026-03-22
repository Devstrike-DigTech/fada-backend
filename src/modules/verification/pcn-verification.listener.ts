import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EVENTS, PcnVerificationRequestedPayload } from '@common/types/events.types';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';

@Injectable()
export class PcnVerificationListener {
  private readonly logger = new Logger(PcnVerificationListener.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.VERIFICATION_PCN)
    private readonly pcnQueue: Queue,
  ) {}

  @OnEvent(EVENTS.PHARMACY.PCN_VERIFICATION_REQUESTED, { async: true })
  async handlePcnVerificationRequested(
    payload: PcnVerificationRequestedPayload,
  ): Promise<void> {
    this.logger.log(
      `Queuing PCN verification for pharmacist ${payload.pharmacistId}, license ${payload.licenseNumber}`,
    );

    await this.pcnQueue.add('verify', payload, {
      jobId: `pcn:${payload.pharmacistId}`,
      removeOnComplete: true,
    });
  }
}
