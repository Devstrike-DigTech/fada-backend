import { Global, Module } from '@nestjs/common';
import { PaystackService } from './paystack.service';

@Global()
@Module({
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaymentsModule {}
