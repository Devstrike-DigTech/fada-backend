import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_NAMES } from '@infra/queue/queue.constants';
import { ReservationExpiryProcessor } from '@jobs/reservation/reservation-expiry.processor';
import { ReservationStockOutListener } from './listeners/reservation-stock-out.listener';
import { ReservationController } from './reservation.controller';
import { ReservationService } from './reservation.service';

@Module({
  imports: [
    // The RESERVATION_EXPIRY queue is already registered globally by QueueModule.
    // We still reference it here so @InjectQueue() resolves correctly in the service.
    BullModule.registerQueue({ name: QUEUE_NAMES.RESERVATION_EXPIRY }),
  ],
  controllers: [ReservationController],
  providers: [
    ReservationService,
    ReservationExpiryProcessor,
    ReservationStockOutListener,
  ],
  exports: [ReservationService],
})
export class ReservationModule {}
