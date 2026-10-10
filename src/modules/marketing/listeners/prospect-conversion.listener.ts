import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS, PharmacyRegisteredPayload } from '@common/types/events.types';
import { MarketingService } from '../marketing.service';

/** Closes the loop: a prospect the team courted signs up → marked converted. */
@Injectable()
export class ProspectConversionListener {
  private readonly logger = new Logger(ProspectConversionListener.name);

  constructor(private readonly marketing: MarketingService) {}

  @OnEvent(EVENTS.PHARMACY.REGISTERED, { async: true })
  async onPharmacyRegistered(payload: PharmacyRegisteredPayload) {
    try {
      await this.marketing.markConverted(payload.pharmacyId);
    } catch (err) {
      this.logger.error(
        `Prospect matching failed for pharmacy ${payload.pharmacyId}`,
        err as Error,
      );
    }
  }
}
