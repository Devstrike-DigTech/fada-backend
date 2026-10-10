import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { AdsService } from '@modules/ads/ads.service';
import {
  AdminCampaignQueryDto,
  AdminCampaignStatusDto,
  AdminReviewCampaignDto,
} from './dto/admin-ads.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/ads', version: '1' })
export class AdminAdsController {
  constructor(private readonly ads: AdsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Campaign counts, review queue, 30-day engagement and ad revenue',
  })
  overview() {
    return this.ads.adminOverview();
  }

  @Get('campaigns')
  @ApiOperation({ summary: 'All campaigns (pending review first)' })
  list(@Query() query: AdminCampaignQueryDto) {
    return this.ads.adminListCampaigns(query);
  }

  @Get('campaigns/:id')
  @ApiOperation({ summary: 'Campaign with analytics and billing' })
  detail(@Param('id') id: string) {
    return this.ads.adminGetCampaign(id);
  }

  @Post('campaigns/:id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a campaign' })
  review(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AdminReviewCampaignDto,
  ) {
    return this.ads.adminReview(id, dto.decision, dto.reason, admin.sub);
  }

  @Post('campaigns/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force pause / resume / cancel' })
  status(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AdminCampaignStatusDto,
  ) {
    return this.ads.adminForceStatus(id, dto.action, dto.reason, admin.sub);
  }
}
