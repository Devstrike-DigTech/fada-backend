import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import { AllowGuest } from '@common/decorators/allow-guest.decorator';
import { AdsService } from './ads.service';
import {
  CampaignAnalyticsQueryDto,
  CampaignCheckoutDto,
  CampaignQueryDto,
  CampaignStatusActionDto,
  CreateCampaignDto,
  QuoteCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';
import {
  AdFeedQueryDto,
  RateAdDto,
  RecordClickDto,
  RecordImpressionsDto,
} from './dto/feed.dto';

const guestHeader = {
  name: 'x-guest-token',
  required: false,
  description: 'Stable UUID for the guest session (client-generated)',
};

@ApiTags('Ads')
@Controller({ path: 'ads', version: '1' })
export class AdsController {
  constructor(private readonly adsService: AdsService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Pharmacy campaign management  (declared first so ':id' never shadows them)
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('pharmacy/:pharmacyId/campaigns')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List a pharmacy’s ad campaigns' })
  listCampaigns(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Query() query: CampaignQueryDto,
  ) {
    return this.adsService.listCampaigns(user.sub, pharmacyId, query);
  }

  @Post('pharmacy/:pharmacyId/campaigns/quote')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Price preview: ₦250 × daily frequency × weekly days × weeks, less plan and promo discounts',
  })
  quote(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: QuoteCampaignDto,
  ) {
    return this.adsService.quote(user.sub, pharmacyId, dto);
  }

  @Post('pharmacy/:pharmacyId/campaigns')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Create a campaign (Zuko / Aang plans)',
    description:
      'Created as a draft pending back-office review. Pay via /checkout; it goes live once paid, approved and inside its slot.',
  })
  createCampaign(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.adsService.createCampaign(user.sub, pharmacyId, dto);
  }

  @Get('pharmacy/:pharmacyId/campaigns/:id')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get one campaign' })
  getCampaign(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('id') id: string,
  ) {
    return this.adsService.getCampaign(user.sub, pharmacyId, id);
  }

  @Put('pharmacy/:pharmacyId/campaigns/:id')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update a campaign',
    description:
      'Content changes send the campaign back to review. Schedule/pricing cannot change after payment.',
  })
  updateCampaign(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.adsService.updateCampaign(user.sub, pharmacyId, id, dto);
  }

  @Post('pharmacy/:pharmacyId/campaigns/:id/creative')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload the campaign banner image (JPEG/PNG/WebP, ≤ 5 MB)',
  })
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/image\/(jpeg|png|webp)/)) {
          cb(new Error('Only JPEG, PNG and WebP images are allowed'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  uploadCreative(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.adsService.uploadCreative(user.sub, pharmacyId, id, file);
  }

  @Patch('pharmacy/:pharmacyId/campaigns/:id/status')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Pause, resume or cancel a campaign' })
  changeStatus(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('id') id: string,
    @Body() dto: CampaignStatusActionDto,
  ) {
    return this.adsService.changeStatus(user.sub, pharmacyId, id, dto);
  }

  @Delete('pharmacy/:pharmacyId/campaigns/:id')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Delete an unpaid draft, or cancel a paid campaign',
  })
  deleteCampaign(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('id') id: string,
  ) {
    return this.adsService.deleteCampaign(user.sub, pharmacyId, id);
  }

  @Post('pharmacy/:pharmacyId/campaigns/:id/checkout')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Pay for a campaign (owner only) — returns a hosted checkout URL',
  })
  checkout(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('id') id: string,
    @Body() dto: CampaignCheckoutDto,
  ) {
    return this.adsService.checkout(user.sub, pharmacyId, id, dto);
  }

  @Get('pharmacy/:pharmacyId/campaigns/:id/analytics')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Impressions, clicks, CTR, unique viewers, rating and daily series',
  })
  analytics(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('id') id: string,
    @Query() query: CampaignAnalyticsQueryDto,
  ) {
    return this.adsService.getAnalytics(user.sub, pharmacyId, id, query);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Customer side
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('feed')
  @AllowGuest()
  @ApiHeader(guestHeader)
  @ApiOperation({
    summary: 'Ads near the viewer',
    description:
      'Pass latitude/longitude for geo-targeting; otherwise falls back to state. Honours each campaign’s daily frequency cap per viewer.',
  })
  feed(
    @CurrentUser() user: CurrentUserData | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Query() query: AdFeedQueryDto,
  ) {
    return this.adsService.getFeed(
      { customerId: user?.sub, guestToken },
      query,
    );
  }

  @Post('impressions')
  @AllowGuest()
  @HttpCode(HttpStatus.OK)
  @ApiHeader(guestHeader)
  @ApiOperation({
    summary: 'Record that ads were rendered (deduplicated per viewer per hour)',
  })
  impressions(
    @CurrentUser() user: CurrentUserData | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Body() dto: RecordImpressionsDto,
  ) {
    return this.adsService.recordImpressions(
      { customerId: user?.sub, guestToken },
      dto,
    );
  }

  @Post('clicks')
  @AllowGuest()
  @HttpCode(HttpStatus.OK)
  @ApiHeader(guestHeader)
  @ApiOperation({ summary: 'Record an ad click' })
  click(
    @CurrentUser() user: CurrentUserData | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Body() dto: RecordClickDto,
  ) {
    return this.adsService.recordClick(
      { customerId: user?.sub, guestToken },
      dto,
    );
  }

  @Post(':id/ratings')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Rate an ad 1–5 stars (one rating per customer, updatable)',
  })
  rate(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: RateAdDto,
  ) {
    return this.adsService.rate(user.sub, id, dto);
  }

  @Get(':id')
  @AllowGuest()
  @ApiHeader(guestHeader)
  @ApiOperation({ summary: 'Ad detail for the "Ad Info" screen' })
  detail(@Param('id') id: string) {
    return this.adsService.getAdDetail(id);
  }
}
