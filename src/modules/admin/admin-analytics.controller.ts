import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { AnalyticsService } from '@modules/analytics/analytics.service';
import {
  LeaderboardQueryDto,
  PeriodQueryDto,
  RebuildDto,
  TrendsQueryDto,
} from '@modules/analytics/dto/analytics.dto';
import { AdminAuditService } from './admin-audit.service';

/** Platform analytics. Per-pharmacy dashboards: admins can call /analytics/pharmacy/:id/* directly. */
@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/analytics', version: '1' })
export class AdminAnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('platform')
  @ApiOperation({
    summary:
      'Growth, reservations, search, ads and revenue per day with % change',
  })
  platform(@Query() q: PeriodQueryDto) {
    return this.analytics.platform(q);
  }

  @Get('search-trends')
  @ApiOperation({
    summary: 'Most searched and zero-result queries (unmet demand)',
  })
  trends(@Query() q: TrendsQueryDto) {
    return this.analytics.searchTrends(q);
  }

  @Get('pharmacies/leaderboard')
  @ApiOperation({ summary: 'Top pharmacies by a chosen metric over a period' })
  leaderboard(@Query() q: LeaderboardQueryDto) {
    return this.analytics.leaderboard(q);
  }

  @Post('snapshots/rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Recompute daily snapshots for a range (max 90 days, past days only)',
    description:
      'Search counters live in Redis for 9 days; rebuilding older days keeps the search numbers already stored.',
  })
  async rebuild(
    @CurrentUser() admin: CurrentUserData,
    @Body() dto: RebuildDto,
    @Ip() ip: string,
  ) {
    const result = await this.analytics.rebuild(dto.from, dto.to);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'analytics.rebuild',
      targetType: 'analytics',
      details: { ...dto, queued: result.queued },
      ipAddress: ip,
    });
    return result;
  }
}
