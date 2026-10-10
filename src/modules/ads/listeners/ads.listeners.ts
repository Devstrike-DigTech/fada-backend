import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AdPaymentSuccessfulPayload, EVENTS } from '@common/types/events.types';
import { AdsService } from '../ads.service';

@Injectable()
export class AdsListeners {
  private readonly logger = new Logger(AdsListeners.name);

  constructor(private readonly adsService: AdsService) {}

  /** Billing lives in SubscriptionModule; it tells us when a campaign is paid. */
  @OnEvent(EVENTS.ADS.PAYMENT_SUCCESSFUL, { async: true })
  async onPaymentSuccessful(
    payload: AdPaymentSuccessfulPayload,
  ): Promise<void> {
    try {
      await this.adsService.onPaymentSuccessful(payload);
    } catch (err) {
      this.logger.error(
        `Failed to apply ad payment ${payload.reference}`,
        err as Error,
      );
    }
  }
}
