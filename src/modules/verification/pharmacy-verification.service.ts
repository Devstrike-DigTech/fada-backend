import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import {
  AdminActionPayload,
  CacVerificationCompletedPayload,
  EVENTS,
  PcnVerificationCompletedPayload,
  PharmacyRegisteredPayload,
  PharmacyVerifiedPayload,
} from '@common/types/events.types';

/**
 * A pharmacy is verified — visible in search and able to take reservations —
 * when its owner's PCN licence AND its CAC registration are both verified.
 *
 * Recomputed whenever either check finishes (in any order: PCN usually runs at
 * pharmacist sign-up, before the pharmacy exists) and when a pharmacy is
 * registered. Admins can verify manually when a registry is unavailable.
 */
@Injectable()
export class PharmacyVerificationService {
  private readonly logger = new Logger(PharmacyVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async recompute(
    pharmacyId: string,
  ): Promise<{ isVerified: boolean; changed: boolean; missing: string[] }> {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: {
        id: true,
        isVerified: true,
        cacVerified: true,
        ownerId: true,
        pharmacistProfiles: {
          where: { roleInPharmacy: 'owner' },
          select: { userId: true, pcnVerified: true },
        },
      },
    });
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');

    const owner =
      pharmacy.pharmacistProfiles.find((p) => p.userId === pharmacy.ownerId) ??
      pharmacy.pharmacistProfiles[0];
    const missing: string[] = [];
    if (!owner?.pcnVerified) missing.push('owner_pcn_licence');
    if (!pharmacy.cacVerified) missing.push('cac_registration');
    const isVerified = missing.length === 0;

    if (isVerified === pharmacy.isVerified)
      return { isVerified, changed: false, missing };

    await this.prisma.pharmacy.update({
      where: { id: pharmacyId },
      data: { isVerified },
    });
    this.logger.log(
      `Pharmacy ${pharmacyId} is now ${isVerified ? 'VERIFIED' : 'unverified'}`,
    );
    if (isVerified) {
      const payload: PharmacyVerifiedPayload = {
        pharmacyId,
        verifiedAt: new Date(),
      };
      this.eventBus.emit(EVENTS.PHARMACY.VERIFIED, payload);
    }
    return { isVerified, changed: true, missing };
  }

  /**
   * What a pharmacy owner sees while waiting: each requirement and whether it
   * is met. Read-only; `recompute` is what flips `isVerified`.
   */
  async status(pharmacyId: string) {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: {
        isVerified: true,
        cacNumber: true,
        cacVerified: true,
        ownerId: true,
        pharmacistProfiles: {
          where: { roleInPharmacy: 'owner' },
          select: {
            userId: true,
            pcnVerified: true,
            licenseNumber: true,
            licenseType: true,
          },
        },
      },
    });
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');
    const owner =
      pharmacy.pharmacistProfiles.find((p) => p.userId === pharmacy.ownerId) ??
      pharmacy.pharmacistProfiles[0];
    const pcnVerified = owner?.pcnVerified ?? false;
    const missing: string[] = [];
    if (!pcnVerified) missing.push('owner_pcn_licence');
    if (!pharmacy.cacVerified) missing.push('cac_registration');
    return {
      isVerified: pharmacy.isVerified && missing.length === 0,
      missing,
      pcn: {
        verified: pcnVerified,
        licenseNumber: owner?.licenseNumber ?? null,
        licenseType: owner?.licenseType ?? null,
      },
      cac: { verified: pharmacy.cacVerified, number: pharmacy.cacNumber },
    };
  }

  /** Back office: mark the business registration verified by hand, then recompute. */
  async adminVerify(pharmacyId: string, adminUserId: string, note?: string) {
    const exists = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Pharmacy not found');
    await this.prisma.pharmacy.update({
      where: { id: pharmacyId },
      data: { cacVerified: true, cacVerifiedAt: new Date() },
    });
    const result = await this.recompute(pharmacyId);
    this.audit(adminUserId, 'pharmacy.verify', pharmacyId, { note, ...result });
    return result;
  }

  /** Back office: withdraw verification (hides the pharmacy from search). */
  async adminUnverify(pharmacyId: string, adminUserId: string, reason: string) {
    const exists = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Pharmacy not found');
    await this.prisma.pharmacy.update({
      where: { id: pharmacyId },
      data: { cacVerified: false, cacVerifiedAt: null },
    });
    const result = await this.recompute(pharmacyId);
    this.audit(adminUserId, 'pharmacy.unverify', pharmacyId, {
      reason,
      ...result,
    });
    return result;
  }

  // ─── Triggers ────────────────────────────────────────────────────────────────

  @OnEvent(EVENTS.PHARMACY.CAC_VERIFICATION_COMPLETED, { async: true })
  @OnEvent(EVENTS.PHARMACY.CAC_VERIFICATION_FAILED, { async: true })
  async onCac(p: CacVerificationCompletedPayload): Promise<void> {
    await this.safely(p.pharmacyId);
  }

  @OnEvent(EVENTS.PHARMACY.PCN_VERIFICATION_COMPLETED, { async: true })
  @OnEvent(EVENTS.PHARMACY.PCN_VERIFICATION_FAILED, { async: true })
  async onPcn(p: PcnVerificationCompletedPayload): Promise<void> {
    const profile = await this.prisma.pharmacistProfile.findUnique({
      where: { userId: p.pharmacistId },
      select: { pharmacyId: true },
    });
    if (profile?.pharmacyId) await this.safely(profile.pharmacyId);
  }

  @OnEvent(EVENTS.PHARMACY.REGISTERED, { async: true })
  async onRegistered(p: PharmacyRegisteredPayload): Promise<void> {
    await this.safely(p.pharmacyId);
  }

  private async safely(pharmacyId: string): Promise<void> {
    try {
      await this.recompute(pharmacyId);
    } catch (err) {
      this.logger.error(
        `Verification recompute failed for ${pharmacyId}`,
        err as Error,
      );
    }
  }

  private audit(
    adminUserId: string,
    action: string,
    targetId: string,
    details: Record<string, unknown>,
  ) {
    const payload: AdminActionPayload = {
      adminUserId,
      action,
      targetType: 'pharmacy',
      targetId,
      details,
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.ADMIN.ACTION_PERFORMED, payload);
  }
}
