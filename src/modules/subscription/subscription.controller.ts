import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import { Public } from '@common/decorators/public.decorator';
import { SubscriptionService } from './subscription.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { BillingHistoryQueryDto } from './dto/billing-history-query.dto';
import { PaymentCallbackQueryDto } from './dto/payment-callback-query.dto';

@ApiTags('Subscription')
@Controller({ path: 'subscriptions', version: '1' })
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly config: ConfigService,
  ) {}

  // ─── Plans ───────────────────────────────────────────────────────────────────

  @Get('plans')
  @Public()
  @ApiOperation({
    summary: 'List all subscription plans with pricing and features',
  })
  listPlans() {
    return this.subscriptionService.listPlans();
  }

  // ─── Current subscription ────────────────────────────────────────────────────

  @Get('pharmacy/:pharmacyId')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'pharmacyId' })
  @ApiOperation({
    summary: 'Current subscription, entitlements and usage for a pharmacy',
  })
  getCurrent(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
  ) {
    return this.subscriptionService.getCurrentSubscription(
      user.sub,
      pharmacyId,
    );
  }

  // ─── Subscribe ───────────────────────────────────────────────────────────────

  @Post('pharmacy/:pharmacyId/subscribe')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Subscribe to a plan (owner only)',
    description:
      'Free plan activates immediately. Paid plans return a hosted checkout URL; ' +
      'the subscription activates when the payment webhook or the callback verification succeeds.',
  })
  subscribe(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: SubscribeDto,
  ) {
    return this.subscriptionService.subscribe(user.sub, pharmacyId, dto);
  }

  // ─── Upgrade / downgrade ─────────────────────────────────────────────────────

  @Post('pharmacy/:pharmacyId/upgrade')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Change plan (owner only)',
    description:
      'Upgrades with more than the threshold days left are pro-rated and charged now via checkout. ' +
      'Upgrades near renewal and all downgrades take effect at the next renewal. ' +
      'One change per cooldown window.',
  })
  changePlan(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: ChangePlanDto,
  ) {
    return this.subscriptionService.changePlan(user.sub, pharmacyId, dto);
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────────

  @Post('pharmacy/:pharmacyId/cancel')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Cancel auto-renewal (owner only). Access continues until the period ends.',
  })
  cancel(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptionService.cancel(user.sub, pharmacyId, dto);
  }

  // ─── Billing history ─────────────────────────────────────────────────────────

  @Get('pharmacy/:pharmacyId/billing-history')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Paginated billing records for a pharmacy' })
  billingHistory(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Query() query: BillingHistoryQueryDto,
  ) {
    return this.subscriptionService.getBillingHistory(
      user.sub,
      pharmacyId,
      query,
    );
  }

  // ─── Payment verification ────────────────────────────────────────────────────

  @Get('payments/verify/:reference')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Verify a checkout reference with the provider and activate if paid',
    description:
      'Safe to poll from the app after the user returns from the hosted checkout.',
  })
  verify(@Param('reference') reference: string) {
    return this.subscriptionService.verifyPaymentReference(reference);
  }

  @Get('payments/callback')
  @Public()
  @ApiOperation({
    summary: 'Hosted-checkout return URL',
    description:
      'Paystack returns ?reference=…, Flutterwave returns ?tx_ref=…&status=…. Verifies the payment, ' +
      'then redirects to PAYMENT_SUCCESS_REDIRECT_URL when configured or returns JSON.',
  })
  async callback(
    @Query() query: PaymentCallbackQueryDto,
    @Res() res: Response,
  ) {
    const reference = query.reference ?? query.trxref ?? query.tx_ref;
    const redirectBase = this.config.get<string>('payments.successRedirectUrl');

    if (!reference) {
      if (redirectBase)
        return res.redirect(`${redirectBase}?status=missing_reference`);
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: 'Missing payment reference' });
    }

    let status = 'failed';
    try {
      const result =
        await this.subscriptionService.verifyPaymentReference(reference);
      status = result.status;
      if (!redirectBase) return res.json({ reference, ...result });
    } catch {
      if (!redirectBase) {
        return res
          .status(HttpStatus.NOT_FOUND)
          .json({ reference, status: 'unknown_reference' });
      }
      status = 'unknown_reference';
    }

    const url = new URL(redirectBase);
    url.searchParams.set('reference', reference);
    url.searchParams.set('status', status);
    return res.redirect(url.toString());
  }
}
