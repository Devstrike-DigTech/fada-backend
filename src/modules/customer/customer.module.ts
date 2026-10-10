import { Module } from '@nestjs/common';
import { SearchModule } from '@modules/search/search.module';
import { ReservationModule } from '@modules/reservation/reservation.module';
import { CustomerController } from './customer.controller';
import { SavesController } from './saves.controller';
import { CustomerProfileService } from './customer-profile.service';
import { SavesService } from './saves.service';
import { CustomerHistoryService } from './customer-history.service';
import { SearchHistoryListener } from './listeners/search-history.listener';

/**
 * Customer-side features: profile & addresses, saves (drugs, pharmacies,
 * named lists with batch reservation), and search / reservation history.
 */
@Module({
  imports: [SearchModule, ReservationModule],
  controllers: [CustomerController, SavesController],
  providers: [
    CustomerProfileService,
    SavesService,
    CustomerHistoryService,
    SearchHistoryListener,
  ],
  exports: [CustomerProfileService, SavesService],
})
export class CustomerModule {}
