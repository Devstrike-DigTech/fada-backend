import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { PeriodQueryDto } from './dto/analytics.dto';

/**
 * Pharmacy store analytics. Owners and operators only; requires a plan with
 * analytics (Zuko / Aang). Admins can open any pharmacy. Periods use Lagos
 * calendar days: `?period=7d|30d|90d|365d` or `?from=&to=`.
 */
@ApiTags('Analytics')
@ApiBearerAuth('access-token')
@Roles(UserRole.PHARMACIST, UserRole.STAFF, UserRole.ADMIN)
@Controller({ path: 'analytics/pharmacy/:pharmacyId', version: '1' })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('access')
  @ApiOperation({
    summary:
      'Whether this pharmacy’s plan includes analytics (drives the upgrade prompt)',
  })
  access(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
  ) {
    return this.analytics.access(user, pharmacyId);
  }

  @Get('overview')
  @ApiOperation({
    summary:
      'Headline totals with % change vs the previous period, KPIs, and a daily series',
  })
  overview(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Query() q: PeriodQueryDto,
  ) {
    return this.analytics.overview(user, pharmacyId, q);
  }

  @Get('reservations')
  @ApiOperation({
    summary:
      'Reservation outcomes, timing, branches, busiest hours and weekdays',
  })
  reservations(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Query() q: PeriodQueryDto,
  ) {
    return this.analytics.reservations(user, pharmacyId, q);
  }

  @Get('inventory')
  @ApiOperation({
    summary:
      'Slot usage, stock status, most reserved/saved drugs, restock and expiry lists',
  })
  inventory(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Query() q: PeriodQueryDto,
  ) {
    return this.analytics.inventory(user, pharmacyId, q);
  }

  @Get('search-appearances')
  @ApiOperation({
    summary:
      'How often the pharmacy appeared in search, for which queries, plus unmet demand across FADA',
  })
  searchAppearances(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Query() q: PeriodQueryDto,
  ) {
    return this.analytics.searchAppearances(user, pharmacyId, q);
  }

  @Get('ads')
  @ApiOperation({
    summary: 'Ad impressions, clicks, CTR, spend and per-campaign results',
  })
  ads(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Query() q: PeriodQueryDto,
  ) {
    return this.analytics.ads(user, pharmacyId, q);
  }
}
