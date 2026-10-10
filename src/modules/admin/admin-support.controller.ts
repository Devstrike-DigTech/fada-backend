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
import { SupportService } from '@modules/support/support.service';
import {
  AdminSuggestionQueryDto,
  AdminTicketMessageDto,
  AdminTicketQueryDto,
  AdminUpdateSuggestionDto,
  AdminUpdateTicketDto,
} from '@modules/support/dto/support.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/support', version: '1' })
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Open, unassigned, high-priority and stale ticket counts; new suggestions',
  })
  summary() {
    return this.support.adminSummary();
  }

  @Get('tickets')
  @ApiOperation({
    summary: 'Ticket queue (open and urgent first) with filters',
  })
  tickets(@Query() query: AdminTicketQueryDto) {
    return this.support.adminListTickets(query);
  }

  @Get('tickets/:id')
  @ApiOperation({
    summary:
      'Ticket with submitter, linked reservation/pharmacy, and full thread incl. internal notes',
  })
  ticket(@Param('id') id: string) {
    return this.support.adminGetTicket(id);
  }

  @Patch('tickets/:id')
  @ApiOperation({
    summary: 'Change status, priority, assignee, resolution note',
  })
  updateTicket(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AdminUpdateTicketDto,
  ) {
    return this.support.adminUpdateTicket(id, dto, admin.sub);
  }

  @Post('tickets/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Reply to the user, or add an internal note (internal: true)',
  })
  reply(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AdminTicketMessageDto,
  ) {
    return this.support.adminReply(id, dto, admin.sub);
  }

  @Get('suggestions')
  @ApiOperation({ summary: 'Feature suggestions with counts by area' })
  suggestions(@Query() query: AdminSuggestionQueryDto) {
    return this.support.adminListSuggestions(query);
  }

  @Patch('suggestions/:id')
  @ApiOperation({
    summary:
      'Set suggestion status (reviewing / planned / shipped / declined) with a note',
  })
  updateSuggestion(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AdminUpdateSuggestionDto,
  ) {
    return this.support.adminUpdateSuggestion(id, dto, admin.sub);
  }
}
