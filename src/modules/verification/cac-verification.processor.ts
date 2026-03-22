import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { CacRegistryService } from '@infra/registries/cac-registry.service';
import { EVENTS, CacVerificationRequestedPayload } from '@common/types/events.types';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';

@Processor(QUEUE_NAMES.VERIFICATION_CAC)
export class CacVerificationProcessor {
  private readonly logger = new Logger(CacVerificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly cacRegistry: CacRegistryService,
  ) {}

  @Process('verify')
  async processCacVerification(
    job: Job<CacVerificationRequestedPayload>,
  ): Promise<void> {
    const { pharmacyId, cacNumber } = job.data;

    this.logger.log(
      `Processing CAC verification — pharmacy: ${pharmacyId}, RC: ${cacNumber}`,
    );

    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      include: {
        pharmacistProfiles: {
          where: { roleInPharmacy: 'owner' },
          include: { user: true },
          take: 1,
        },
      },
    });

    if (!pharmacy) {
      this.logger.warn(`Pharmacy not found: ${pharmacyId}`);
      return;
    }

    if (pharmacy.cacVerified) {
      this.logger.log(`Pharmacy ${pharmacyId} already CAC-verified — skipping`);
      return;
    }

    let isValid = false;

    try {
      const result = await this.cacRegistry.lookupCompany(cacNumber);
      isValid = result.found;

      this.logger.log(`CAC lookup for RC ${cacNumber}: found=${result.found}`);
    } catch (err) {
      this.logger.error(
        `CAC registry call failed for RC ${cacNumber}: ${(err as Error).message}`,
      );
      throw err; // Trigger BullMQ retry
    }

    await this.prisma.pharmacy.update({
      where: { id: pharmacyId },
      data: {
        cacVerified: isValid,
        cacVerifiedAt: isValid ? new Date() : null,
      },
    });

    const owner = pharmacy.pharmacistProfiles[0];

    if (isValid) {
      this.logger.log(`CAC verified for pharmacy ${pharmacyId}`);

      await this.eventBus.emit(EVENTS.PHARMACY.CAC_VERIFICATION_COMPLETED, {
        pharmacyId,
        cacNumber,
        isValid: true,
        verifiedAt: new Date(),
      });

      if (owner) {
        await this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
          to: owner.user.email,
          subject: 'Your pharmacy CAC registration has been verified ✓',
          templateId: 'cac-verified',
          templateData: {
            firstName: owner.firstName,
            pharmacyName: pharmacy.name,
            cacNumber,
          },
          userId: owner.userId,
        });
      }
    } else {
      this.logger.warn(
        `CAC verification failed for pharmacy ${pharmacyId} (RC: ${cacNumber})`,
      );

      await this.eventBus.emit(EVENTS.PHARMACY.CAC_VERIFICATION_FAILED, {
        pharmacyId,
        cacNumber,
        isValid: false,
        verifiedAt: new Date(),
      });

      if (owner) {
        await this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
          to: owner.user.email,
          subject: 'CAC verification could not be completed',
          templateId: 'cac-failed',
          templateData: {
            firstName: owner.firstName,
            pharmacyName: pharmacy.name,
            cacNumber,
          },
          userId: owner.userId,
        });
      }
    }
  }
}
