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
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import { ContentService } from '@modules/content/content.service';
import { SupportService } from './support.service';
import {
  ComplaintQueryDto,
  CreateComplaintDto,
  CreateSuggestionDto,
  TicketMessageDto,
} from './dto/support.dto';

@ApiTags('Support')
@Controller({ path: 'support', version: '1' })
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly content: ContentService,
  ) {}

  @Get('contact')
  @Public()
  @ApiOperation({ summary: 'Support contact details (email, hours, phone)' })
  contact() {
    return this.content.getPage('contact');
  }

  @Get('categories')
  @Public()
  @ApiOperation({
    summary: 'Complaint categories and suggestion areas for the app dropdowns',
  })
  categories() {
    return this.support.categories();
  }

  // ─── Complaints ──────────────────────────────────────────────────────────────

  @Post('complaints')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'File a complaint (category, subject, description; optional reservation/pharmacy)',
  })
  createComplaint(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateComplaintDto,
  ) {
    return this.support.createComplaint(user, dto);
  }

  @Get('complaints')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'My complaints, most recently active first' })
  listComplaints(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ComplaintQueryDto,
  ) {
    return this.support.listMyComplaints(user.sub, query);
  }

  @Get('complaints/:id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'One complaint with the conversation' })
  getComplaint(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.support.getMyComplaint(user.sub, id);
  }

  @Post('complaints/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Add a follow-up (reopens a resolved ticket)' })
  reply(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: TicketMessageDto,
  ) {
    return this.support.replyToMyComplaint(user.sub, id, dto);
  }

  // ─── Suggestions ─────────────────────────────────────────────────────────────

  @Post('suggestions')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Suggest a feature' })
  suggest(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateSuggestionDto,
  ) {
    return this.support.createSuggestion(user.sub, dto);
  }

  @Get('suggestions')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'My suggestions and their status' })
  mySuggestions(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ComplaintQueryDto,
  ) {
    return this.support.listMySuggestions(user.sub, query);
  }
}
