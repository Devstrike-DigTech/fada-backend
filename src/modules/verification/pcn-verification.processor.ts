import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { PcnRegistryService } from '@infra/registries/pcn-registry.service';
import { EVENTS, PcnVerificationRequestedPayload } from '@common/types/events.types';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';

@Processor(QUEUE_NAMES.VERIFICATION_PCN)
export class PcnVerificationProcessor {
  private readonly logger = new Logger(PcnVerificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly pcnRegistry: PcnRegistryService,
  ) {}

  @Process('verify')
  async processPcnVerification(
    job: Job<PcnVerificationRequestedPayload>,
  ): Promise<void> {
    const { pharmacistId, licenseNumber } = job.data;

    this.logger.log(
      `Processing PCN verification — pharmacist: ${pharmacistId}, license: ${licenseNumber}`,
    );

    // Fetch pharmacist profile with user info
    const profile = await this.prisma.pharmacistProfile.findUnique({
      where: { userId: pharmacistId },
      include: { user: true },
    });

    if (!profile) {
      this.logger.warn(`PharmacistProfile not found for userId ${pharmacistId}`);
      return;
    }

    // Skip if already verified (e.g. admin already overrode it)
    if (profile.pcnVerified) {
      this.logger.log(
        `Pharmacist ${pharmacistId} already verified — skipping auto-check`,
      );
      return;
    }

    let isValid = false;

    try {
      const result = await this.pcnRegistry.lookupLicense(licenseNumber);
      isValid = result.found;

      this.logger.log(
        `PCN lookup for ${licenseNumber}: found=${result.found}`,
      );
    } catch (err) {
      this.logger.error(
        `PCN registry call failed for ${licenseNumber}: ${(err as Error).message}`,
      );
      // Re-throw so Bull retries the job
      throw err;
    }

    // Update the profile
    await this.prisma.pharmacistProfile.update({
      where: { userId: pharmacistId },
      data: {
        pcnVerified: isValid,
        pcnVerifiedAt: isValid ? new Date() : null,
        pcnVerificationSource: 'auto',
      },
    });

    if (isValid) {
      this.logger.log(`PCN verified for pharmacist ${pharmacistId}`);

      this.eventBus.emit(EVENTS.PHARMACY.PCN_VERIFICATION_COMPLETED, {
        pharmacistId,
        licenseNumber,
        isValid: true,
        verifiedAt: new Date(),
      });

      this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
        to: profile.user.email,
        subject: 'Your PCN license has been verified ✓',
        templateId: 'pcn-verified',
        templateData: {
          firstName: profile.firstName,
          licenseNumber,
        },
        userId: pharmacistId,
      });
    } else {
      this.logger.warn(
        `PCN verification failed for pharmacist ${pharmacistId} (license: ${licenseNumber})`,
      );

      this.eventBus.emit(EVENTS.PHARMACY.PCN_VERIFICATION_FAILED, {
        pharmacistId,
        licenseNumber,
        isValid: false,
        verifiedAt: new Date(),
      });

      this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
        to: profile.user.email,
        subject: 'PCN license verification failed',
        templateId: 'pcn-failed',
        templateData: {
          firstName: profile.firstName,
          licenseNumber,
        },
        userId: pharmacistId,
      });
    }
  }
}
