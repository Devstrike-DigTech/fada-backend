import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS, StockOutPayload } from '@common/types/events.types';
import { ReservationService } from '../reservation.service';

/**
 * Listens for INVENTORY.STOCK_OUT events and auto-cancels any pending,
 * confirmed, or ready reservations that include the affected drug.
 *
 * This keeps inventory and reservations consistent without requiring the
 * InventoryService to know about ReservationService.
 */
@Injectable()
export class ReservationStockOutListener {
  private readonly logger = new Logger(ReservationStockOutListener.name);

  constructor(private readonly reservationService: ReservationService) {}

  @OnEvent(EVENTS.INVENTORY.STOCK_OUT, { async: true })
  async handleStockOut(payload: StockOutPayload): Promise<void> {
    this.logger.warn(
      `Stock-out event received for drug ${payload.drugId} in branch ${payload.branchId}. ` +
        `Checking for affected reservations…`,
    );

    try {
      await this.reservationService.cancelReservationsForDrug(
        payload.drugId,
        payload.pharmacistUserId,
      );
    } catch (err) {
      // Log but don't rethrow — a failure here shouldn't crash the stock update
      this.logger.error(
        `Error cancelling reservations for drug ${payload.drugId}`,
        err,
      );
    }
  }
}
