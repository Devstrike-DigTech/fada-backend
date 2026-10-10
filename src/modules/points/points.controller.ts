import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import { AllowGuest } from '@common/decorators/allow-guest.decorator';
import { PointsService } from './points.service';
import { LeaderboardQueryDto, PointsHistoryQueryDto } from './dto/points.dto';

@ApiTags('Points')
@Controller({ path: 'points', version: '1' })
export class PointsController {
  constructor(private readonly points: PointsService) {}

  @Get('levels')
  @Public()
  @ApiOperation({ summary: 'Reputation levels and their thresholds' })
  levels() {
    return this.points.listLevels();
  }

  @Get('rules')
  @Public()
  @ApiQuery({ name: 'owner', required: false, enum: ['customer', 'pharmacy'] })
  @ApiOperation({ summary: 'How points are earned' })
  rules(@Query('owner') owner?: 'customer' | 'pharmacy') {
    return this.points.listRules(owner);
  }

  @Get('leaderboard/pharmacies')
  @Public()
  @ApiOperation({
    summary: 'Top pharmacies by lifetime points, optionally per state',
  })
  leaderboard(@Query() query: LeaderboardQueryDto) {
    return this.points.pharmacyLeaderboard(query);
  }

  @Get('customer/:customerId')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Customer balance and level (self or admin)' })
  customer(
    @CurrentUser() user: CurrentUserData,
    @Param('customerId') customerId: string,
  ) {
    return this.points.getCustomerSummary(user, customerId);
  }

  @Get('customer/:customerId/history')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Customer points transactions (self or admin)' })
  customerHistory(
    @CurrentUser() user: CurrentUserData,
    @Param('customerId') customerId: string,
    @Query() query: PointsHistoryQueryDto,
  ) {
    return this.points.getCustomerHistory(user, customerId, query);
  }

  @Get('pharmacy/:pharmacyId')
  @AllowGuest()
  @ApiOperation({
    summary:
      'Pharmacy reputation (public). Members and admins also see the balance.',
  })
  pharmacy(
    @CurrentUser() user: CurrentUserData | undefined,
    @Param('pharmacyId') pharmacyId: string,
  ) {
    return this.points.getPharmacySummary(user, pharmacyId);
  }

  @Get('pharmacy/:pharmacyId/history')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Pharmacy points transactions (members or admin)' })
  pharmacyHistory(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Query() query: PointsHistoryQueryDto,
  ) {
    return this.points.getPharmacyHistory(user, pharmacyId, query);
  }
}
