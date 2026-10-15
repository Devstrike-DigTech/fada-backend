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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
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
import { PharmacyVerificationService } from '@modules/verification/pharmacy-verification.service';
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
  constructor(
    private readonly pharmacyService: PharmacyService,
    private readonly verification: PharmacyVerificationService,
  ) {}

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

  @Get('me/verification')
  @Roles(UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      "What the logged-in pharmacist's pharmacy still needs to be verified (PCN licence, CAC registration)",
  })
  async getMyVerification(@CurrentUser() user: CurrentUserData) {
    const pharmacy = await this.pharmacyService.getMyPharmacy(user.sub);
    return this.verification.status(pharmacy.id);
  }

  // ─── Staff self-service (before :pharmacyId routes) ────────────────────────

  @Get('staff/me')
  @Roles(UserRole.STAFF, UserRole.PHARMACIST)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Pharmacies and branches the signed-in staff member works at',
  })
  myMemberships(@CurrentUser() user: CurrentUserData) {
    return this.pharmacyService.myMemberships(user.sub);
  }

  @Get('staff/invites/:token')
  @Public()
  @ApiOperation({
    summary: 'Preview a staff invite before accepting (pharmacy, branch, role)',
  })
  previewInvite(@Param('token') token: string) {
    return this.pharmacyService.previewInvite(token);
  }

  @Get('staff/join/:token')
  @Public()
  @ApiOperation({
    summary:
      'Landing page the invite email links to; opens the FADA Pharmacy app at the invite',
  })
  async joinPage(@Param('token') token: string, @Res() res: Response) {
    let title = 'Join your team on FADA';
    let body =
      'This invite link is not valid. Ask the pharmacy owner to send a new one.';
    let ok = false;
    try {
      const p = await this.pharmacyService.previewInvite(token);
      ok = p.status === 'pending';
      title = `Join ${p.pharmacyName} on FADA`;
      body =
        p.status === 'accepted'
          ? 'This invite has already been used. Sign in to the FADA Pharmacy app.'
          : p.status === 'expired'
            ? 'This invite has expired. Ask the pharmacy owner to send a new one.'
            : `${p.firstName}, you’re invited as ${p.role === 'operator' ? 'an operator' : 'staff'}` +
              `${p.branchName ? ` at ${p.branchName}` : ''}. Open the FADA Pharmacy app to set your password and start.`;
    } catch {
      // unknown token: keep the generic message
    }
    const esc = (s: string) =>
      s.replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
      );
    const appLink = `fadapharmacy://open/join/${encodeURIComponent(token)}`;
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font:16px -apple-system,system-ui,sans-serif;background:#f5f8f7;color:#10231f;display:grid;place-items:center;min-height:100vh}
.card{background:#fff;border-radius:22px;padding:30px 24px;width:min(380px,88vw);box-shadow:0 10px 30px rgba(16,35,31,.08);text-align:center}
.mark{width:56px;height:56px;border-radius:16px;background:#399386;margin:0 auto 18px}
h1{font-size:22px;margin:0 0 10px}p{color:#4b605b;line-height:1.5;margin:0 0 22px}
a{display:block;background:#399386;color:#fff;text-decoration:none;font-weight:700;border-radius:14px;padding:16px}
small{display:block;color:#889a95;margin-top:16px;font-size:13px}</style></head>
<body><div class="card"><div class="mark"></div><h1>${esc(title)}</h1><p>${esc(body)}</p>
${ok ? `<a href="${appLink}">Open FADA Pharmacy</a><small>No app yet? Install FADA Pharmacy, then tap this link again.</small>` : ''}
</div></body></html>`);
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
