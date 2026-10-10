import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
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
import { PromotionsService } from '@modules/promotions/promotions.service';
import {
  CreatePromotionDto,
  PromotionQueryDto,
  UpdatePromotionDto,
} from '@modules/promotions/dto/promotion.dto';
import { AdminAuditService } from './admin-audit.service';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/promotions', version: '1' })
export class AdminPromotionsController {
  constructor(
    private readonly promotions: PromotionsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List promotions (seasonal discounts and promo codes)',
  })
  list(@Query() query: PromotionQueryDto) {
    return this.promotions.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Promotion with recent redemptions' })
  get(@Param('id') id: string) {
    return this.promotions.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a promotion',
    description:
      'autoApply=true makes it a seasonal discount applied to every eligible checkout; otherwise pharmacies must enter the code.',
  })
  async create(
    @CurrentUser() admin: CurrentUserData,
    @Body() dto: CreatePromotionDto,
    @Ip() ip: string,
  ) {
    const promo = await this.promotions.create(dto, admin.sub);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'promotion.create',
      targetType: 'promotion',
      targetId: promo.id,
      details: { ...dto },
      ipAddress: ip,
    });
    return promo;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a promotion' })
  async update(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdatePromotionDto,
    @Ip() ip: string,
  ) {
    const promo = await this.promotions.update(id, dto, admin.sub);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'promotion.update',
      targetType: 'promotion',
      targetId: id,
      details: { ...dto },
      ipAddress: ip,
    });
    return promo;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a promotion (history is kept)' })
  async deactivate(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    const promo = await this.promotions.deactivate(id, admin.sub);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'promotion.deactivate',
      targetType: 'promotion',
      targetId: id,
      ipAddress: ip,
    });
    return promo;
  }
}
