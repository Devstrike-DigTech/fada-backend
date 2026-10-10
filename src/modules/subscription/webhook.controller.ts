import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { SKIP_ALL_THROTTLERS } from '@common/security/throttle.constants';
import { Request } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { SubscriptionService } from './subscription.service';

/**
 * Payment-provider webhooks.
 *
 * Both endpoints are public (providers do not carry our JWT) and are instead
 * authenticated by signature: Paystack signs the raw body with HMAC-SHA512,
 * Flutterwave echoes a shared secret in `verif-hash`. The raw body is available
 * because `main.ts` boots Nest with `rawBody: true`.
 */
// Providers retry on non-2xx; requests are authenticated by signature instead
@SkipThrottle(SKIP_ALL_THROTTLERS)
@ApiExcludeController()
@Controller({ path: 'subscriptions/webhook', version: '1' })
export class SubscriptionWebhookController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post('paystack')
  @Public()
  @HttpCode(HttpStatus.OK)
  paystack(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    return this.subscriptionService.handleWebhook(
      'paystack',
      req.rawBody,
      signature,
      body,
    );
  }

  @Post('flutterwave')
  @Public()
  @HttpCode(HttpStatus.OK)
  flutterwave(
    @Req() req: RawBodyRequest<Request>,
    @Headers('verif-hash') signature: string | undefined,
    @Body() body: unknown,
  ) {
    return this.subscriptionService.handleWebhook(
      'flutterwave',
      req.rawBody,
      signature,
      body,
    );
  }
}
