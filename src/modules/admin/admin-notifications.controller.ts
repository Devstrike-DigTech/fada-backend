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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { BroadcastDto } from '@modules/notifications/dto/notifications.dto';
import { AdminAuditService } from './admin-audit.service';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/notifications', version: '1' })
export class AdminNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Post('broadcast')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Send an announcement to customers, pharmacists, everyone, or a list of users',
    description:
      'Fans out in the background. Push, SMS and email respect each user’s channel toggles and muted categories; the in-app copy is always kept.',
  })
  async broadcast(
    @CurrentUser() admin: CurrentUserData,
    @Body() dto: BroadcastDto,
    @Ip() ip: string,
  ) {
    const result = await this.notifications.enqueueBroadcast(dto, admin.sub);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'notifications.broadcast',
      targetType: 'broadcast',
      targetId: result.broadcastId,
      details: {
        audience: dto.audience,
        userCount: dto.userIds?.length,
        title: dto.title,
        category: dto.category ?? 'system',
        channels: dto.channels ?? ['in_app', 'push'],
        estimatedRecipients: result.estimatedRecipients,
      },
      ipAddress: ip,
    });
    return result;
  }

  @Get('stats')
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOperation({
    summary: 'Delivery outcomes per channel and recent failures',
  })
  stats(@Query('days') days?: string) {
    const n = Math.min(Math.max(parseInt(days ?? '7', 10) || 7, 1), 90);
    return this.notifications.deliveryStats(n);
  }
}
