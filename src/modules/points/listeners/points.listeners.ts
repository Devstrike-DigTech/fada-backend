import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@infra/database/prisma.service';
import {
  AdCampaignPayload,
  CustomerProfileUpdatedPayload,
  DrugAddedPayload,
  EVENTS,
  PharmacyProfileCompletedPayload,
  PharmacyRegisteredPayload,
  ReservationStatusChangedPayload,
  UserVerifiedPayload,
} from '@common/types/events.types';
import { PointsService } from '../points.service';

/**
 * Maps domain events to earning rules. Every handler is idempotent because
 * PointsService keys awards on (ledger, reason, referenceId).
 */
@Injectable()
export class PointsListeners {
  private readonly logger = new Logger(PointsListeners.name);

  constructor(
    private readonly points: PointsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Registration (+50) is paid once the email is verified, not on sign-up. */
  @OnEvent(EVENTS.AUTH.USER_VERIFIED, { async: true })
  async onUserVerified(payload: UserVerifiedPayload): Promise<void> {
    await this.safely('customer.registration', () =>
      this.points.awardByRule(
        'customer.registration',
        { kind: 'customer', userId: payload.userId },
        payload.userId,
      ),
    );
  }

  @OnEvent(EVENTS.PHARMACY.REGISTERED, { async: true })
  async onPharmacyRegistered(
    payload: PharmacyRegisteredPayload,
  ): Promise<void> {
    await this.safely('pharmacy.registration', () =>
      this.points.awardByRule(
        'pharmacy.registration',
        { kind: 'pharmacy', pharmacyId: payload.pharmacyId },
        payload.pharmacyId,
      ),
    );
  }

  @OnEvent(EVENTS.RESERVATION.SERVED, { async: true })
  async onReservationServed(
    payload: ReservationStatusChangedPayload,
  ): Promise<void> {
    await this.safely('customer.reservation_completed', () =>
      this.points.awardByRule(
        'customer.reservation_completed',
        { kind: 'customer', userId: payload.customerId },
        payload.reservationId,
        { metadata: { reservationCode: payload.reservationCode } },
      ),
    );
    await this.safely('pharmacy.reservation_completed', () =>
      this.points.awardByRule(
        'pharmacy.reservation_completed',
        { kind: 'pharmacy', pharmacyId: payload.pharmacyId },
        payload.reservationId,
        {
          metadata: {
            reservationCode: payload.reservationCode,
            servedBy: payload.pharmacistId,
          },
        },
      ),
    );
  }

  @OnEvent(EVENTS.INVENTORY.DRUG_ADDED, { async: true })
  async onDrugAdded(payload: DrugAddedPayload): Promise<void> {
    let pharmacyId = payload.pharmacyId;
    if (!pharmacyId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: payload.branchId },
        select: { pharmacyId: true },
      });
      pharmacyId = branch?.pharmacyId ?? '';
    }
    if (!pharmacyId) return;
    await this.safely('pharmacy.drug_added', () =>
      this.points.awardByRule(
        'pharmacy.drug_added',
        { kind: 'pharmacy', pharmacyId },
        payload.drugId,
        { metadata: { drugName: payload.drugName } },
      ),
    );
  }

  @OnEvent(EVENTS.ADS.CAMPAIGN_ACTIVATED, { async: true })
  async onCampaignActivated(payload: AdCampaignPayload): Promise<void> {
    await this.safely('pharmacy.ad_launched', () =>
      this.points.awardByRule(
        'pharmacy.ad_launched',
        { kind: 'pharmacy', pharmacyId: payload.pharmacyId },
        payload.campaignId,
        { metadata: { title: payload.title } },
      ),
    );
  }

  @OnEvent(EVENTS.CUSTOMER.PROFILE_COMPLETED, { async: true })
  async onCustomerProfileCompleted(
    payload: CustomerProfileUpdatedPayload,
  ): Promise<void> {
    await this.safely('customer.profile_completed', () =>
      this.points.awardByRule(
        'customer.profile_completed',
        { kind: 'customer', userId: payload.customerId },
        payload.customerId,
      ),
    );
  }

  @OnEvent(EVENTS.PHARMACY.PROFILE_COMPLETED, { async: true })
  async onPharmacyProfileCompleted(
    payload: PharmacyProfileCompletedPayload,
  ): Promise<void> {
    await this.safely('pharmacy.profile_completed', () =>
      this.points.awardByRule(
        'pharmacy.profile_completed',
        { kind: 'pharmacy', pharmacyId: payload.pharmacyId },
        payload.pharmacyId,
      ),
    );
  }

  private async safely(
    rule: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`Points rule ${rule} failed`, err as Error);
    }
  }
}
