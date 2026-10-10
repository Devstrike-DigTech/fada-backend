import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { MarketingService } from '@modules/marketing/marketing.service';
import { MarketerAccountsService } from '@modules/marketing/marketer-accounts.service';
import {
  AdminProspectQueryDto,
  CreateMarketerDto,
  CreateSalesRouteDto,
  LinkProspectDto,
  MarketerQueryDto,
  MarketingSummaryQueryDto,
  UpdateSalesRouteDto,
} from '@modules/marketing/dto/marketing.dto';
import { AdminAuditService } from './admin-audit.service';

/** Back office for the field team: funnel, routes, marketer accounts. */
@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/marketing', version: '1' })
export class AdminMarketingController {
  constructor(
    private readonly marketing: MarketingService,
    private readonly accounts: MarketerAccountsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Pipeline funnel, period activity (calls, visits, responses, conversions), per route and per marketer',
  })
  summary(@Query() query: MarketingSummaryQueryDto) {
    return this.marketing.adminSummary(query);
  }

  // ─── Prospects ───────────────────────────────────────────────────────────────

  @Get('prospects')
  @ApiOperation({
    summary: 'All prospects incl. filters by marketer, conversion and removed',
  })
  prospects(@Query() query: AdminProspectQueryDto) {
    return this.marketing.adminListProspects(query);
  }

  @Get('prospects/:id')
  @ApiOperation({ summary: 'Prospect with history (removed ones included)' })
  prospect(@Param('id') id: string) {
    return this.marketing.getProspect(id, { includeDeleted: true });
  }

  @Post('prospects/:id/link')
  @ApiOperation({
    summary: 'Mark a prospect as converted into a FADA pharmacy',
  })
  async link(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: LinkProspectDto,
  ) {
    const result = await this.marketing.linkToPharmacy(id, dto.pharmacyId);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'marketing.prospect.linked',
      targetType: 'pharmacy_prospect',
      targetId: id,
      details: { pharmacyId: dto.pharmacyId },
    });
    return result;
  }

  @Post('prospects/:id/restore')
  @ApiOperation({ summary: 'Bring a removed prospect back into the pipeline' })
  async restore(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
  ) {
    const result = await this.marketing.restoreProspect(id);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'marketing.prospect.restored',
      targetType: 'pharmacy_prospect',
      targetId: id,
    });
    return result;
  }

  // ─── Routes ──────────────────────────────────────────────────────────────────

  @Get('routes')
  @ApiOperation({ summary: 'All routes incl. retired, with prospect counts' })
  routes() {
    return this.marketing.listRoutes(true);
  }

  @Post('routes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a sales route' })
  async createRoute(
    @CurrentUser() admin: CurrentUserData,
    @Body() dto: CreateSalesRouteDto,
  ) {
    const route = await this.marketing.createRoute(dto);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'marketing.route.created',
      targetType: 'sales_route',
      targetId: route.id,
      details: { name: route.name },
    });
    return route;
  }

  @Patch('routes/:id')
  @ApiOperation({ summary: 'Rename, reorder, describe or retire a route' })
  async updateRoute(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateSalesRouteDto,
  ) {
    const route = await this.marketing.updateRoute(id, dto);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'marketing.route.updated',
      targetType: 'sales_route',
      targetId: id,
      details: { ...dto },
    });
    return route;
  }

  // ─── Marketer accounts ───────────────────────────────────────────────────────

  @Get('marketers')
  @ApiOperation({ summary: 'Marketer accounts with prospects added' })
  marketers(@Query() query: MarketerQueryDto) {
    return this.accounts.list(query);
  }

  @Post('marketers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a marketer account; the temporary password is returned once and must be changed on first login',
  })
  async createMarketer(
    @CurrentUser() admin: CurrentUserData,
    @Body() dto: CreateMarketerDto,
  ) {
    const result = await this.accounts.create(dto);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'marketing.marketer.created',
      targetType: 'user',
      targetId: result.id,
      details: { email: result.email },
    });
    return result;
  }

  @Post('marketers/:id/reset-password')
  @ApiOperation({
    summary:
      'Issue a new temporary password and sign the marketer out everywhere',
  })
  async resetMarketerPassword(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
  ) {
    const result = await this.accounts.resetPassword(id);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'marketing.marketer.password_reset',
      targetType: 'user',
      targetId: id,
    });
    return result;
  }

  @Post('marketers/:id/deactivate')
  @ApiOperation({ summary: 'Deactivate a marketer (history is kept)' })
  async deactivate(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
  ) {
    const result = await this.accounts.setActive(id, false);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'marketing.marketer.deactivated',
      targetType: 'user',
      targetId: id,
    });
    return result;
  }

  @Post('marketers/:id/activate')
  @ApiOperation({ summary: 'Re-activate a marketer' })
  async activate(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
  ) {
    const result = await this.accounts.setActive(id, true);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'marketing.marketer.activated',
      targetType: 'user',
      targetId: id,
    });
    return result;
  }
}
