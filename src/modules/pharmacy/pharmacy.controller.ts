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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { Public } from '@common/decorators/public.decorator';
import { UserRole } from '@common/decorators/roles.decorator';
import { PharmacyService } from './pharmacy.service';
import { CreatePharmacyDto } from './dto/create-pharmacy.dto';
import { UpdatePharmacyDto } from './dto/update-pharmacy.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { AcceptStaffInviteDto } from './dto/accept-staff-invite.dto';
import { SetWorkingHoursDto } from './dto/set-working-hours.dto';

@ApiTags('Pharmacy')
@Controller({ path: 'pharmacy', version: '1' })
export class PharmacyController {
  constructor(private readonly pharmacyService: PharmacyService) {}

  // ─── Create Pharmacy ────────────────────────────────────────────────────────

  @Post()
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Register a new pharmacy (pharmacist only)' })
  createPharmacy(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreatePharmacyDto,
  ) {
    return this.pharmacyService.createPharmacy(user.sub, dto);
  }

  // ─── Get My Pharmacy ────────────────────────────────────────────────────────

  @Get('me')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the pharmacy associated with the logged-in pharmacist',
  })
  getMyPharmacy(@CurrentUser() user: CurrentUserData) {
    return this.pharmacyService.getMyPharmacy(user.sub);
  }

  // ─── Update Pharmacy ────────────────────────────────────────────────────────

  @Patch(':pharmacyId')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update pharmacy details (owner only)' })
  updatePharmacy(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: UpdatePharmacyDto,
  ) {
    return this.pharmacyService.updatePharmacy(user.sub, pharmacyId, dto);
  }

  // ─── Public Pharmacy Profile ────────────────────────────────────────────────

  @Get(':pharmacyId')
  @Public()
  @ApiOperation({ summary: 'Get public pharmacy profile by ID' })
  getPharmacyProfile(@Param('pharmacyId') pharmacyId: string) {
    return this.pharmacyService.getPublicPharmacyProfile(pharmacyId);
  }

  // ─── Branches ───────────────────────────────────────────────────────────────

  @Get(':pharmacyId/branches')
  @Public()
  @ApiOperation({ summary: 'List all active branches of a pharmacy' })
  getBranches(@Param('pharmacyId') pharmacyId: string) {
    return this.pharmacyService.getBranches(pharmacyId);
  }

  @Post(':pharmacyId/branches')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Add a new branch to the pharmacy (owner/operator)',
  })
  addBranch(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.pharmacyService.addBranch(user.sub, pharmacyId, dto);
  }

  @Patch(':pharmacyId/branches/:branchId')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update branch details (owner/operator)' })
  updateBranch(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.pharmacyService.updateBranch(
      user.sub,
      pharmacyId,
      branchId,
      dto,
    );
  }

  @Delete(':pharmacyId/branches/:branchId')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Deactivate a branch (owner only)' })
  deleteBranch(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('branchId') branchId: string,
  ) {
    return this.pharmacyService.deleteBranch(user.sub, pharmacyId, branchId);
  }

  // ─── Working Hours ──────────────────────────────────────────────────────────

  @Post(':pharmacyId/branches/:branchId/hours')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Set working hours for a branch (owner/operator)',
    description:
      'Upserts working hours. Send any subset of days. ' +
      'Omitted days retain their existing schedule.',
  })
  setWorkingHours(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('branchId') branchId: string,
    @Body() dto: SetWorkingHoursDto,
  ) {
    return this.pharmacyService.setWorkingHours(
      user.sub,
      pharmacyId,
      branchId,
      dto,
    );
  }

  // ─── Images ─────────────────────────────────────────────────────────────────

  @Post(':pharmacyId/images')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a pharmacy image (max 10 images)' })
  @ApiQuery({
    name: 'primary',
    required: false,
    type: Boolean,
    description: 'Set this image as the primary/cover image',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/image\/(jpeg|png|webp)/)) {
          cb(new Error('Only JPEG, PNG and WebP images are allowed'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  uploadImage(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('primary') primary?: string,
  ) {
    return this.pharmacyService.uploadPharmacyImage(
      user.sub,
      pharmacyId,
      file,
      primary === 'true',
    );
  }

  @Patch(':pharmacyId/images/:imageId/primary')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Set an image as the primary/cover photo' })
  setPrimaryImage(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.pharmacyService.setPrimaryImage(user.sub, pharmacyId, imageId);
  }

  @Delete(':pharmacyId/images/:imageId')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete a pharmacy image' })
  deleteImage(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.pharmacyService.deletePharmacyImage(
      user.sub,
      pharmacyId,
      imageId,
    );
  }

  // ─── Staff ──────────────────────────────────────────────────────────────────

  @Post(':pharmacyId/staff/invite')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Invite a person to join the pharmacy as operator or staff (owner/operator only)',
  })
  inviteStaff(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Body() dto: InviteStaffDto,
  ) {
    return this.pharmacyService.inviteStaff(user.sub, pharmacyId, dto);
  }

  @Post('staff/accept-invite/:token')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a staff invite and create/link account',
  })
  acceptStaffInvite(
    @Param('token') token: string,
    @Body() dto: AcceptStaffInviteDto,
  ) {
    return this.pharmacyService.acceptStaffInvite(token, dto);
  }

  @Get(':pharmacyId/staff')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List active staff members (owner/operator only)' })
  getStaff(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
  ) {
    return this.pharmacyService.getStaff(user.sub, pharmacyId);
  }

  @Get(':pharmacyId/staff/invites')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List pending invites (owner/operator only)',
  })
  getPendingInvites(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
  ) {
    return this.pharmacyService.getPendingInvites(user.sub, pharmacyId);
  }

  @Delete(':pharmacyId/staff/invites/:inviteId')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke a pending invite (owner only)' })
  revokeInvite(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.pharmacyService.revokeInvite(user.sub, pharmacyId, inviteId);
  }

  @Delete(':pharmacyId/staff/:staffUserId')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Remove a staff member from the pharmacy (owner only)',
  })
  removeStaff(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
    @Param('staffUserId') staffUserId: string,
  ) {
    return this.pharmacyService.removeStaff(user.sub, pharmacyId, staffUserId);
  }
}
