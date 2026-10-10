import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { PointsService } from '@modules/points/points.service';
import { AdminAdjustPointsDto } from '@modules/points/dto/points.dto';
import { AdminAuditService } from './admin-audit.service';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/points', version: '1' })
export class AdminPointsController {
  constructor(
    private readonly points: PointsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Post('adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Credit or debit points on a customer or pharmacy ledger',
    description:
      'Use for goodwill, disputes, promotions. Debits cannot take a balance below zero.',
  })
  async adjust(
    @CurrentUser() admin: CurrentUserData,
    @Body() dto: AdminAdjustPointsDto,
    @Ip() ip: string,
  ) {
    const result = await this.points.adminAdjust(dto, admin.sub);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'points.adjust.request',
      targetType: dto.userId ? 'user' : 'pharmacy',
      targetId: dto.userId ?? dto.pharmacyId,
      details: { ...dto },
      ipAddress: ip,
    });
    return result;
  }
}
