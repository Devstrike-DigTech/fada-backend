import { Module } from '@nestjs/common';
import { PromotionsService } from './promotions.service';

/**
 * Promotions have no public controller: pharmacies apply them through
 * subscription / ad checkouts, and the back office manages them through
 * AdminModule's promotions controller.
 */
@Module({
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
