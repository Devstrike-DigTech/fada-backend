import { Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { ReservationService } from '@modules/reservation/reservation.service';

/**
 * Processes the reservation expiry queue.
 *
 * The ReservationService schedules a repeatable job (cron: every 5 minutes)
 * when the application boots. Each run of this processor:
 *   1. Queries for pending/confirmed/ready reservations past their `expiresAt`.
 *   2. Expires each one individually so events fire per reservation.
 *
 * Running items individually (not bulk-update) ensures that:
 *   - Each expiry event fires with the correct payload.
 *   - Downstream listeners (notifications, analytics) get per-reservation context.
 */
@Processor(QUEUE_NAMES.RESERVATION_EXPIRY)
export class ReservationExpiryProcessor {
  private readonly logger = new Logger(ReservationExpiryProcessor.name);

  constructor(private readonly reservationService: ReservationService) {}

  @Process('expire')
  async handleExpiry(job: Job): Promise<void> {
    this.logger.debug(`Reservation expiry sweep started (jobId: ${job.id})`);

    const expiredIds =
      await this.reservationService.findExpiredReservationIds();

    if (expiredIds.length === 0) {
      this.logger.debug('No reservations to expire');
      return;
    }

    this.logger.log(`Expiring ${expiredIds.length} reservation(s)…`);

    let succeeded = 0;
    let failed = 0;

    for (const id of expiredIds) {
      try {
        await this.reservationService.expireReservation(id);
        succeeded++;
      } catch (err) {
        failed++;
        this.logger.error(`Failed to expire reservation ${id}`, err);
      }
    }

    this.logger.log(
      `Expiry sweep complete — expired: ${succeeded}, failed: ${failed}`,
    );
  }
}
