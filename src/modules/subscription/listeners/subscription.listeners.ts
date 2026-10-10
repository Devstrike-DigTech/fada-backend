import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS, PharmacyRegisteredPayload } from '@common/types/events.types';
import { SubscriptionService } from '../subscription.service';

/**
 * Gives every newly registered pharmacy a free-plan subscription row so
 * entitlement checks never have to special-case "no subscription yet".
 */
@Injectable()
export class SubscriptionListeners {
  private readonly logger = new Logger(SubscriptionListeners.name);

  constructor(private readonly subscriptionService: SubscriptionService) {}

  @OnEvent(EVENTS.PHARMACY.REGISTERED, { async: true })
  async onPharmacyRegistered(
    payload: PharmacyRegisteredPayload,
  ): Promise<void> {
    try {
      await this.subscriptionService.ensureSubscription(payload.pharmacyId);
    } catch (err) {
      // Entitlements fall back to free-plan limits anyway; log for ops.
      this.logger.error(
        `Could not assign free plan to pharmacy ${payload.pharmacyId}`,
        err as Error,
      );
    }
  }
}
