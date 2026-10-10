import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import {
  MarkAllReadDto,
  NotificationHistoryQueryDto,
  RegisterDeviceTokenDto,
  UpdatePreferencesDto,
} from './dto/notifications.dto';

/** Any signed-in user (customer, pharmacist, staff, admin) has a notification centre. */
@ApiTags('Notification')
@ApiBearerAuth('access-token')
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // ─── Device tokens ───────────────────────────────────────────────────────────

  @Post('device-tokens')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Register this device for push (call after login and on token refresh)',
  })
  registerToken(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.notifications.registerToken(user.sub, dto);
  }

  @Delete('device-tokens/:token')
  @ApiOperation({ summary: 'Stop push to this device (call on logout)' })
  removeToken(
    @CurrentUser() user: CurrentUserData,
    @Param('token') token: string,
  ) {
    return this.notifications.removeToken(user.sub, token);
  }

  // ─── History ─────────────────────────────────────────────────────────────────

  @Get('history')
  @ApiOperation({
    summary: 'In-app notifications, newest first (meta includes unreadCount)',
  })
  history(
    @CurrentUser() user: CurrentUserData,
    @Query() query: NotificationHistoryQueryDto,
  ) {
    return this.notifications.history(user.sub, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Badge count' })
  async unread(@CurrentUser() user: CurrentUserData) {
    return { unreadCount: await this.notifications.unreadCount(user.sub) };
  }

  @Put('read-all')
  @ApiOperation({ summary: 'Mark all (optionally one category) as read' })
  readAll(@CurrentUser() user: CurrentUserData, @Body() dto: MarkAllReadDto) {
    return this.notifications.markAllRead(user.sub, dto.category);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  read(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove one notification from history' })
  remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.notifications.remove(user.sub, id);
  }

  // ─── Preferences ─────────────────────────────────────────────────────────────

  @Get('preferences')
  @ApiOperation({ summary: 'Channel toggles and per-category mutes' })
  getPreferences(@CurrentUser() user: CurrentUserData) {
    return this.notifications.getPreferences(user.sub);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update channel toggles and muted categories' })
  updatePreferences(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.notifications.updatePreferences(user.sub, dto);
  }
}
