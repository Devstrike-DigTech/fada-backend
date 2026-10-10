import {
  Body,
  Controller,
  Delete,
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
import { MarketingService } from './marketing.service';
import {
  CreateProspectDto,
  LogInteractionDto,
  ProspectQueryDto,
  UpdateProspectDto,
} from './dto/marketing.dto';

/** Used by the Fada: Marketer field app. Marketers share one team pipeline. */
@ApiTags('Marketing')
@ApiBearerAuth('access-token')
@Roles(UserRole.MARKETER, UserRole.ADMIN)
@Controller({ path: 'marketing', version: '1' })
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Team pipeline counts and my calls/visits today and this week',
  })
  summary(@CurrentUser() user: CurrentUserData) {
    return this.marketing.marketerSummary(user.sub);
  }

  @Get('routes')
  @ApiOperation({ summary: 'Active sales routes for the add-prospect form' })
  routes() {
    return this.marketing.listRoutes(false);
  }

  @Get('prospects')
  @ApiOperation({
    summary:
      'Prospects by stage (to_call, to_visit, visited) with route, search and "mine" filters',
  })
  list(@CurrentUser() user: CurrentUserData, @Query() query: ProspectQueryDto) {
    return this.marketing.listProspects(user.sub, query);
  }

  @Post('prospects')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Add a pharmacy to the pipeline (409 with the existing id if the phone is already listed)',
  })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateProspectDto) {
    return this.marketing.createProspect(user.sub, dto);
  }

  @Get('prospects/:id')
  @ApiOperation({
    summary: 'Prospect profile with the full call/visit history',
  })
  get(@Param('id') id: string) {
    return this.marketing.getProspect(id);
  }

  @Patch('prospects/:id')
  @ApiOperation({
    summary: 'Edit contact details, address, route or store type',
  })
  update(@Param('id') id: string, @Body() dto: UpdateProspectDto) {
    return this.marketing.updateProspect(id, dto);
  }

  @Delete('prospects/:id')
  @ApiOperation({
    summary: 'Remove a prospect from the pipeline (soft delete)',
  })
  remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.marketing.removeProspect(user.sub, id);
  }

  @Post('prospects/:id/calls')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Log a call (response + comment); moves a new prospect to "to visit"',
  })
  logCall(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: LogInteractionDto,
  ) {
    return this.marketing.logInteraction(user.sub, id, 'call', dto);
  }

  @Post('prospects/:id/visits')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Log a visit (response + comment, optional location); moves to "visited"',
  })
  logVisit(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: LogInteractionDto,
  ) {
    return this.marketing.logInteraction(user.sub, id, 'visit', dto);
  }
}
