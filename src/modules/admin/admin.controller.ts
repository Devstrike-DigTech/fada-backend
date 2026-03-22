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
import { CurrentUser, CurrentUserData } from '@common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { OverridePcnVerificationDto } from './dto/override-pcn-verification.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { CreateCategoryDto, UpdateCategoryDto, CategoryTypeDto } from './dto/manage-category.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Create Admin ────────────────────────────────────────────────────────

  @Post('admins')
  // @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new admin account' })
  @ApiResponse({ status: 201, description: 'Admin created' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  createAdmin(@Body() dto: CreateAdminDto) {
    return this.adminService.createAdmin(dto.email, dto.password);
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
  @ApiOperation({ summary: 'Manually approve PCN verification for a pharmacist' })
  @ApiParam({ name: 'userId', description: 'The pharmacist user ID' })
  @ApiResponse({ status: 200, description: 'PCN manually verified' })
  @ApiResponse({ status: 400, description: 'Already verified' })
  @ApiResponse({ status: 404, description: 'Pharmacist not found' })
  overridePcnVerification(
    @Param('userId') userId: string,
    @Body() dto: OverridePcnVerificationDto,
    @CurrentUser() admin: CurrentUserData,
  ) {
    return this.adminService.overridePcnVerification(userId, admin.sub, dto.note);
  }

  // ─── Retry Auto PCN Verification ─────────────────────────────────────────

  @Post('pharmacists/:userId/retry-pcn')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-run automatic PCN lookup against the PCN registry' })
  @ApiParam({ name: 'userId', description: 'The pharmacist user ID' })
  @ApiResponse({ status: 200, description: 'Lookup result returned' })
  @ApiResponse({ status: 404, description: 'Pharmacist not found' })
  retryPcnVerification(@Param('userId') userId: string) {
    return this.adminService.retryPcnVerification(userId);
  }

  // ─── Drug Categories ──────────────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({ summary: 'List all drug categories, optionally filtered by type' })
  @ApiQuery({ name: 'type', required: false, enum: CategoryTypeDto })
  listCategories(@Query('type') type?: CategoryTypeDto) {
    return this.adminService.listCategories(type);
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new drug category' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.adminService.createCategory(dto);
  }

  @Patch('categories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a drug category' })
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.adminService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a drug category' })
  deleteCategory(@Param('id') id: string) {
    return this.adminService.deleteCategory(id);
  }
}
