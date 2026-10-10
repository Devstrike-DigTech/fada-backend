import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminAssignPlanDto,
  AdminCancelSubscriptionDto,
  AdminExtendPeriodDto,
  AdminSubscriptionQueryDto,
} from './dto/admin-subscription.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/subscriptions', version: '1' })
export class AdminSubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'All pharmacy subscriptions with filters (status, plan, search)',
  })
  list(@Query() query: AdminSubscriptionQueryDto) {
    return this.subscriptions.adminListSubscriptions(query);
  }

  @Get('revenue')
  @ApiOperation({
    summary: 'MRR estimate, subscriptions by plan, 30-day revenue and failures',
  })
  revenue() {
    return this.subscriptions.adminRevenueOverview();
  }

  @Get(':pharmacyId')
  @ApiOperation({
    summary:
      'One pharmacy’s subscription, entitlements, usage and recent billing',
  })
  detail(@Param('pharmacyId') pharmacyId: string) {
    return this.subscriptions.adminGetSubscription(pharmacyId);
  }

  @Post(':pharmacyId/assign-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Put a pharmacy on a plan without payment (comp, waiting-list perks, disputes)',
  })
  async assignPlan(
    @CurrentUser() admin: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: AdminAssignPlanDto,
    @Ip() ip: string,
  ) {
    const result = await this.subscriptions.adminAssignPlan(
      pharmacyId,
      {
        plan: dto.plan,
        billingInterval: dto.billingInterval,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
        reason: dto.reason,
      },
      admin.sub,
    );
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'subscription.assign_plan.request',
      targetType: 'pharmacy',
      targetId: pharmacyId,
      details: { ...dto },
      ipAddress: ip,
    });
    return result;
  }

  @Post(':pharmacyId/extend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Extend the current period by N days' })
  extend(
    @CurrentUser() admin: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: AdminExtendPeriodDto,
  ) {
    return this.subscriptions.adminExtendPeriod(
      pharmacyId,
      dto.days,
      dto.reason,
      admin.sub,
    );
  }

  @Post(':pharmacyId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a paid subscription (at period end, or immediately)',
  })
  cancel(
    @CurrentUser() admin: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: AdminCancelSubscriptionDto,
  ) {
    return this.subscriptions.adminCancel(pharmacyId, dto, admin.sub);
  }
}
