import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { AdminAuditService } from './admin-audit.service';
import { PharmacyVerificationService } from '@modules/verification/pharmacy-verification.service';
import { OverridePcnVerificationDto } from './dto/override-pcn-verification.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { AdminQueryDto } from './dto/admin-query.dto';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryTypeDto,
} from './dto/manage-category.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly verification: PharmacyVerificationService,
    private readonly audit: AdminAuditService,
  ) {}

  // ─── Admin accounts ──────────────────────────────────────────────────────

  @Get('admins')
  @ApiOperation({ summary: 'List admin accounts' })
  @ApiResponse({ status: 200, description: 'Paginated admin accounts' })
  listAdmins(@Query() query: AdminQueryDto) {
    return this.adminService.listAdmins(query);
  }

  @Post('admins')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new admin account' })
  @ApiResponse({ status: 201, description: 'Admin created' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async createAdmin(
    @CurrentUser() admin: CurrentUserData,
    @Body() dto: CreateAdminDto,
  ) {
    const created = await this.adminService.createAdmin(
      dto.email,
      dto.password,
    );
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'admin.created',
      targetType: 'user',
      targetId: created.id,
      details: { email: created.email },
    });
    return created;
  }

  // ─── List Unverified Pharmacists ─────────────────────────────────────────

  @Get('pharmacists/unverified')
  @ApiOperation({ summary: 'List pharmacists with pending PCN verification' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listUnverified(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.adminService.listUnverifiedPharmacists(page, limit);
  }

  // ─── Manual PCN Override ─────────────────────────────────────────────────

  @Post('pharmacists/:userId/verify-pcn')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually approve PCN verification for a pharmacist',
  })
  @ApiParam({ name: 'userId', description: 'The pharmacist user ID' })
  @ApiResponse({ status: 200, description: 'PCN manually verified' })
  @ApiResponse({ status: 400, description: 'Already verified' })
  @ApiResponse({ status: 404, description: 'Pharmacist not found' })
  async overridePcnVerification(
    @Param('userId') userId: string,
    @Body() dto: OverridePcnVerificationDto,
    @CurrentUser() admin: CurrentUserData,
  ) {
    const result = await this.adminService.overridePcnVerification(
      userId,
      admin.sub,
      dto.note,
    );
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'pharmacist.pcn.verified',
      targetType: 'user',
      targetId: userId,
      details: { source: 'manual', note: dto.note ?? null },
    });
    return result;
  }

  // ─── Retry Auto PCN Verification ─────────────────────────────────────────

  @Post('pharmacists/:userId/retry-pcn')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-run automatic PCN lookup against the PCN registry',
  })
  @ApiParam({ name: 'userId', description: 'The pharmacist user ID' })
  @ApiResponse({ status: 200, description: 'Lookup result returned' })
  @ApiResponse({ status: 404, description: 'Pharmacist not found' })
  async retryPcnVerification(
    @Param('userId') userId: string,
    @CurrentUser() admin: CurrentUserData,
  ) {
    const result = await this.adminService.retryPcnVerification(userId);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'pharmacist.pcn.retried',
      targetType: 'user',
      targetId: userId,
      details: { found: result.found },
    });
    return result;
  }

  // ─── Pharmacy verification ───────────────────────────────────────────────

  @Post('pharmacies/:pharmacyId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verify a pharmacy by hand (marks CAC registration verified, then requires the owner PCN)',
  })
  @ApiParam({ name: 'pharmacyId' })
  verifyPharmacy(
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: OverridePcnVerificationDto,
    @CurrentUser() admin: CurrentUserData,
  ) {
    return this.verification.adminVerify(pharmacyId, admin.sub, dto.note);
  }

  @Post('pharmacies/:pharmacyId/unverify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Withdraw verification (hides the pharmacy from search and reservations)',
  })
  @ApiParam({ name: 'pharmacyId' })
  unverifyPharmacy(
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: OverridePcnVerificationDto,
    @CurrentUser() admin: CurrentUserData,
  ) {
    return this.verification.adminUnverify(
      pharmacyId,
      admin.sub,
      dto.note ?? 'No reason given',
    );
  }

  @Get('pharmacies/:pharmacyId/verification')
  @ApiOperation({
    summary: 'Recompute and show what a pharmacy still needs to be verified',
  })
  @ApiParam({ name: 'pharmacyId' })
  pharmacyVerification(@Param('pharmacyId') pharmacyId: string) {
    return this.verification.recompute(pharmacyId);
  }

  // ─── Drug Categories ──────────────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({
    summary: 'List all drug categories, optionally filtered by type',
  })
  @ApiQuery({ name: 'type', required: false, enum: CategoryTypeDto })
  listCategories(@Query('type') type?: CategoryTypeDto) {
    return this.adminService.listCategories(type);
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new drug category' })
  async createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() admin: CurrentUserData,
  ) {
    const category = await this.adminService.createCategory(dto);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'category.created',
      targetType: 'drug_category',
      targetId: category.id,
      details: {
        type: category.type,
        name: category.name,
        slug: category.slug,
      },
    });
    return category;
  }

  @Patch('categories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a drug category' })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() admin: CurrentUserData,
  ) {
    const category = await this.adminService.updateCategory(id, dto);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'category.updated',
      targetType: 'drug_category',
      targetId: id,
      details: { slug: category.slug, changes: { ...dto } },
    });
    return category;
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a drug category' })
  async deleteCategory(
    @Param('id') id: string,
    @CurrentUser() admin: CurrentUserData,
  ) {
    const result = await this.adminService.deleteCategory(id);
    await this.audit.log({
      adminUserId: admin.sub,
      action: 'category.deleted',
      targetType: 'drug_category',
      targetId: id,
      details: {
        type: result.category.type,
        name: result.category.name,
        slug: result.category.slug,
      },
    });
    return result;
  }
}
