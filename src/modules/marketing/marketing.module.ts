import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { MarketingService } from './marketing.service';
import { MarketerAccountsService } from './marketer-accounts.service';
import { MarketingController } from './marketing.controller';
import { ProspectConversionListener } from './listeners/prospect-conversion.listener';

/**
 * Field marketing: the pharmacy prospect pipeline worked by the Fada: Marketer
 * app (to call → to visit → visited → converted) and the sales routes it runs
 * on. Admin endpoints live in AdminMarketingController.
 */
@Module({
  imports: [AuthModule],
  controllers: [MarketingController],
  providers: [
    MarketingService,
    MarketerAccountsService,
    ProspectConversionListener,
  ],
  exports: [MarketingService, MarketerAccountsService],
})
export class MarketingModule {}
