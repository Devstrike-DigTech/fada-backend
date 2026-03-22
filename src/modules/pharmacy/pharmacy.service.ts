import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { CloudinaryService } from '@infra/storage/cloudinary.service';
import { EVENTS } from '@common/types/events.types';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthService } from '@modules/auth/auth.service';
import { CreatePharmacyDto } from './dto/create-pharmacy.dto';
import { UpdatePharmacyDto } from './dto/update-pharmacy.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { SetWorkingHoursDto } from './dto/set-working-hours.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { AcceptStaffInviteDto } from './dto/accept-staff-invite.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class PharmacyService {
  private readonly logger = new Logger(PharmacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly cloudinary: CloudinaryService,
    private readonly authService: AuthService,
  ) {}

  // ─── Create Pharmacy ────────────────────────────────────────────────────────

  async createPharmacy(
    pharmacistUserId: string,
    dto: CreatePharmacyDto,
  ) {
    // A pharmacist may only own one pharmacy
    const existingProfile = await this.prisma.pharmacistProfile.findUnique({
      where: { userId: pharmacistUserId },
      include: { pharmacy: true },
    });

    if (!existingProfile) {
      throw new NotFoundException('Pharmacist profile not found');
    }

    if (existingProfile.pharmacyId) {
      throw new ConflictException(
        'You are already associated with a pharmacy. Use the invite system to join another.',
      );
    }

    const fadaId = this.generatePharmacyFadaId();

    const pharmacy = await this.prisma.$transaction(async (tx) => {
      const newPharmacy = await tx.pharmacy.create({
        data: {
          fadaId,
          ownerId: pharmacistUserId,
          name: dto.name,
          description: dto.description,
          email: dto.email,
          phone: dto.phone,
          cacNumber: dto.cacNumber,
          state: dto.state,
          city: dto.city,
          address: dto.address,
          landmark: dto.landmark,
          latitude: dto.latitude,
          longitude: dto.longitude,
          foundedYear: dto.foundedYear,
        },
      });

      // Link the pharmacist profile to this pharmacy as owner
      await tx.pharmacistProfile.update({
        where: { userId: pharmacistUserId },
        data: {
          pharmacyId: newPharmacy.id,
          roleInPharmacy: 'owner',
        },
      });

      // Create a default head branch
      await tx.branch.create({
        data: {
          pharmacyId: newPharmacy.id,
          name: `${dto.name} – Main Branch`,
          address: dto.address,
          landmark: dto.landmark,
          latitude: dto.latitude,
          longitude: dto.longitude,
          isHeadBranch: true,
        },
      });

      return newPharmacy;
    });

    await this.eventBus.emit(EVENTS.PHARMACY.REGISTERED, {
      pharmacyId: pharmacy.id,
      pharmacistId: pharmacistUserId,
      pharmacyName: pharmacy.name,
      registeredAt: new Date(),
    });

    // Trigger CAC verification if a number was provided
    if (dto.cacNumber) {
      await this.eventBus.emit(EVENTS.PHARMACY.CAC_VERIFICATION_REQUESTED, {
        pharmacyId: pharmacy.id,
        cacNumber: dto.cacNumber,
        businessName: dto.name,
      });
    }

    this.logger.log(`Pharmacy created: ${pharmacy.id} (${pharmacy.fadaId})`);

    return this.getPharmacyWithDetails(pharmacy.id);
  }

  // ─── Get My Pharmacy ────────────────────────────────────────────────────────

  async getMyPharmacy(pharmacistUserId: string) {
    const profile = await this.prisma.pharmacistProfile.findUnique({
      where: { userId: pharmacistUserId },
    });

    if (!profile?.pharmacyId) {
      throw new NotFoundException('You have not registered a pharmacy yet');
    }

    return this.getPharmacyWithDetails(profile.pharmacyId);
  }

  // ─── Get Pharmacy by ID (public) ────────────────────────────────────────────

  async getPharmacyById(pharmacyId: string) {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId, isActive: true },
      include: {
        images: { orderBy: { isPrimary: 'desc' } },
        branches: {
          where: { isActive: true },
          include: {
            workingHours: { orderBy: { dayOfWeek: 'asc' } },
          },
        },
        subscription: {
          select: { planId: true, status: true, currentPeriodEnd: true },
        },
      },
    });

    if (!pharmacy) {
      throw new NotFoundException('Pharmacy not found');
    }

    return pharmacy;
  }

  // ─── Update Pharmacy ────────────────────────────────────────────────────────

  async updatePharmacy(
    pharmacistUserId: string,
    pharmacyId: string,
    dto: UpdatePharmacyDto,
  ) {
    await this.assertOwnership(pharmacistUserId, pharmacyId);

    const existingPharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
    });
    if (!existingPharmacy) throw new NotFoundException('Pharmacy not found');

    // If CAC number changed, trigger re-verification
    const cacChanged =
      dto.cacNumber &&
      dto.cacNumber !== existingPharmacy.cacNumber;

    const updated = await this.prisma.pharmacy.update({
      where: { id: pharmacyId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.cacNumber !== undefined && {
          cacNumber: dto.cacNumber,
          // Reset verification if CAC number is changing
          ...(cacChanged && { cacVerified: false, cacVerifiedAt: null }),
        }),
        ...(dto.state !== undefined && { state: dto.state }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.landmark !== undefined && { landmark: dto.landmark }),
        ...(dto.latitude !== undefined && { latitude: dto.latitude }),
        ...(dto.longitude !== undefined && { longitude: dto.longitude }),
        ...(dto.foundedYear !== undefined && { foundedYear: dto.foundedYear }),
      },
    });

    if (cacChanged && dto.cacNumber) {
      await this.eventBus.emit(EVENTS.PHARMACY.CAC_VERIFICATION_REQUESTED, {
        pharmacyId,
        cacNumber: dto.cacNumber,
        businessName: updated.name,
      });
    }

    return this.getPharmacyWithDetails(pharmacyId);
  }

  // ─── Branches ───────────────────────────────────────────────────────────────

  async addBranch(
    pharmacistUserId: string,
    pharmacyId: string,
    dto: CreateBranchDto,
  ) {
    await this.assertOwnerOrOperator(pharmacistUserId, pharmacyId);

    // If setting as head branch, un-flag existing
    if (dto.isHeadBranch) {
      await this.prisma.branch.updateMany({
        where: { pharmacyId, isHeadBranch: true },
        data: { isHeadBranch: false },
      });
    }

    const branch = await this.prisma.branch.create({
      data: {
        pharmacyId,
        name: dto.name,
        address: dto.address,
        landmark: dto.landmark,
        latitude: dto.latitude,
        longitude: dto.longitude,
        isHeadBranch: dto.isHeadBranch ?? false,
      },
    });

    await this.eventBus.emit(EVENTS.PHARMACY.BRANCH_ADDED, {
      pharmacyId,
      pharmacistId: pharmacistUserId,
      pharmacyName: branch.name,
      registeredAt: new Date(),
    });

    this.logger.log(`Branch added: ${branch.id} → pharmacy ${pharmacyId}`);
    return branch;
  }

  async updateBranch(
    pharmacistUserId: string,
    pharmacyId: string,
    branchId: string,
    dto: UpdateBranchDto,
  ) {
    await this.assertOwnerOrOperator(pharmacistUserId, pharmacyId);
    await this.assertBranchBelongsToPharmacy(branchId, pharmacyId);

    if (dto.isHeadBranch) {
      await this.prisma.branch.updateMany({
        where: { pharmacyId, isHeadBranch: true, id: { not: branchId } },
        data: { isHeadBranch: false },
      });
    }

    const updated = await this.prisma.branch.update({
      where: { id: branchId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.landmark !== undefined && { landmark: dto.landmark }),
        ...(dto.latitude !== undefined && { latitude: dto.latitude }),
        ...(dto.longitude !== undefined && { longitude: dto.longitude }),
        ...(dto.isHeadBranch !== undefined && { isHeadBranch: dto.isHeadBranch }),
      },
      include: { workingHours: { orderBy: { dayOfWeek: 'asc' } } },
    });

    await this.eventBus.emit(EVENTS.PHARMACY.BRANCH_UPDATED, {
      pharmacyId,
      pharmacistId: pharmacistUserId,
      pharmacyName: updated.name,
      registeredAt: new Date(),
    });

    return updated;
  }

  async deleteBranch(
    pharmacistUserId: string,
    pharmacyId: string,
    branchId: string,
  ) {
    await this.assertOwnership(pharmacistUserId, pharmacyId);
    await this.assertBranchBelongsToPharmacy(branchId, pharmacyId);

    // Cannot delete the last branch
    const branchCount = await this.prisma.branch.count({ where: { pharmacyId } });
    if (branchCount <= 1) {
      throw new BadRequestException('Cannot delete the only branch of a pharmacy');
    }

    // Cannot delete head branch directly — must promote another first
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (branch?.isHeadBranch) {
      throw new BadRequestException(
        'Cannot delete the head branch. Assign another branch as head first.',
      );
    }

    await this.prisma.branch.update({
      where: { id: branchId },
      data: { isActive: false },
    });

    return { message: 'Branch deactivated successfully' };
  }

  async getBranches(pharmacyId: string) {
    return this.prisma.branch.findMany({
      where: { pharmacyId, isActive: true },
      include: { workingHours: { orderBy: { dayOfWeek: 'asc' } } },
      orderBy: [{ isHeadBranch: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // ─── Working Hours ──────────────────────────────────────────────────────────

  async setWorkingHours(
    pharmacistUserId: string,
    pharmacyId: string,
    branchId: string,
    dto: SetWorkingHoursDto,
  ) {
    await this.assertOwnerOrOperator(pharmacistUserId, pharmacyId);
    await this.assertBranchBelongsToPharmacy(branchId, pharmacyId);

    // Upsert each day — delete existing for provided days and recreate
    await this.prisma.$transaction(
      dto.hours.map((h) =>
        this.prisma.pharmacyWorkingHours.upsert({
          where: {
            branchId_dayOfWeek: {
              branchId,
              dayOfWeek: h.dayOfWeek,
            },
          },
          create: {
            branchId,
            dayOfWeek: h.dayOfWeek,
            openTime: h.isClosed ? null : h.openTime,
            closeTime: h.isClosed ? null : h.closeTime,
            isClosed: h.isClosed,
          },
          update: {
            openTime: h.isClosed ? null : h.openTime,
            closeTime: h.isClosed ? null : h.closeTime,
            isClosed: h.isClosed,
          },
        }),
      ),
    );

    return this.prisma.pharmacyWorkingHours.findMany({
      where: { branchId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  // ─── Images ─────────────────────────────────────────────────────────────────

  async uploadPharmacyImage(
    pharmacistUserId: string,
    pharmacyId: string,
    file: Express.Multer.File,
    isPrimary = false,
  ) {
    await this.assertOwnerOrOperator(pharmacistUserId, pharmacyId);

    const imageCount = await this.prisma.pharmacyImage.count({
      where: { pharmacyId },
    });
    if (imageCount >= 10) {
      throw new BadRequestException('Maximum of 10 images per pharmacy allowed');
    }

    const result = await this.cloudinary.uploadImage(
      file.buffer,
      `pharmacies/${pharmacyId}`,
    );

    // If setting as primary, un-flag existing primary
    if (isPrimary) {
      await this.prisma.pharmacyImage.updateMany({
        where: { pharmacyId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const image = await this.prisma.pharmacyImage.create({
      data: {
        pharmacyId,
        url: result.url,
        cloudinaryId: result.publicId,
        isPrimary: isPrimary || imageCount === 0, // first image auto-primary
      },
    });

    return image;
  }

  async deletePharmacyImage(
    pharmacistUserId: string,
    pharmacyId: string,
    imageId: string,
  ) {
    await this.assertOwnerOrOperator(pharmacistUserId, pharmacyId);

    const image = await this.prisma.pharmacyImage.findFirst({
      where: { id: imageId, pharmacyId },
    });
    if (!image) throw new NotFoundException('Image not found');

    if (image.cloudinaryId) {
      await this.cloudinary.deleteImage(image.cloudinaryId);
    }

    await this.prisma.pharmacyImage.delete({ where: { id: imageId } });

    // If deleted image was primary, promote the next image
    if (image.isPrimary) {
      const next = await this.prisma.pharmacyImage.findFirst({
        where: { pharmacyId },
        orderBy: { createdAt: 'asc' },
      });
      if (next) {
        await this.prisma.pharmacyImage.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
      }
    }

    return { message: 'Image deleted successfully' };
  }

  async setPrimaryImage(
    pharmacistUserId: string,
    pharmacyId: string,
    imageId: string,
  ) {
    await this.assertOwnerOrOperator(pharmacistUserId, pharmacyId);

    const image = await this.prisma.pharmacyImage.findFirst({
      where: { id: imageId, pharmacyId },
    });
    if (!image) throw new NotFoundException('Image not found');

    await this.prisma.$transaction([
      this.prisma.pharmacyImage.updateMany({
        where: { pharmacyId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.pharmacyImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      }),
    ]);

    return { message: 'Primary image updated' };
  }

  // ─── Staff Management ───────────────────────────────────────────────────────

  async inviteStaff(
    inviterUserId: string,
    pharmacyId: string,
    dto: InviteStaffDto,
  ) {
    await this.assertOwnerOrOperator(inviterUserId, pharmacyId);

    if (dto.branchId) {
      await this.assertBranchBelongsToPharmacy(dto.branchId, pharmacyId);
    }

    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { name: true },
    });

    // Cancel any existing pending invite for this email+pharmacy
    await this.prisma.pharmacyStaffInvite.deleteMany({
      where: { pharmacyId, email: dto.email.toLowerCase(), acceptedAt: null },
    });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await this.prisma.pharmacyStaffInvite.create({
      data: {
        pharmacyId,
        branchId: dto.branchId ?? null,
        email: dto.email.toLowerCase(),
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        token,
        invitedById: inviterUserId,
        expiresAt,
      },
    });

    this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
      to: dto.email,
      subject: `You've been invited to join ${pharmacy!.name} on FADA`,
      templateId: 'staff-invite',
      templateData: {
        pharmacyName: pharmacy!.name,
        role: dto.role,
        message: dto.message ?? null,
        token,
        expiresInHours: 48,
      },
    });

    this.logger.log(
      `Staff invite sent to ${dto.email} for pharmacy ${pharmacyId} (role: ${dto.role})`,
    );

    return { message: `Invitation sent to ${dto.email}` };
  }

  async acceptStaffInvite(token: string, dto: AcceptStaffInviteDto) {
    const invite = await this.prisma.pharmacyStaffInvite.findUnique({
      where: { token },
      include: {
        pharmacy: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found or already used');
    }
    if (invite.acceptedAt) {
      throw new BadRequestException('This invite has already been accepted');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('This invite has expired. Ask the pharmacy owner to send a new one.');
    }

    // Resolve or create the staff user account
    let staffUser = await this.prisma.user.findUnique({
      where: { email: invite.email },
    });

    if (staffUser) {
      // Account exists — check they're not already a member
      const existing = await this.prisma.pharmacyStaff.findUnique({
        where: { userId_pharmacyId: { userId: staffUser.id, pharmacyId: invite.pharmacyId } },
      });
      if (existing) {
        throw new ConflictException('This user is already a staff member at this pharmacy');
      }
    } else {
      // No account — create one from the invite details
      const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      const fadaId = `STF${Math.floor(1_000_000 + Math.random() * 9_000_000)}`;

      staffUser = await this.prisma.user.create({
        data: {
          email: invite.email,
          passwordHash: hashedPassword,
          role: 'staff',
          fadaId,
          isEmailVerified: true,
          isActive: true,
          firstName: invite.firstName,
          lastName: invite.lastName,
        },
      });

      this.logger.log(`Created staff account ${staffUser.id} for invite ${invite.id}`);
    }

    // Create staff membership and mark invite accepted in one transaction
    await this.prisma.$transaction([
      this.prisma.pharmacyStaffInvite.update({
        where: { token },
        data: { acceptedAt: new Date() },
      }),
      this.prisma.pharmacyStaff.create({
        data: {
          userId: staffUser.id,
          pharmacyId: invite.pharmacyId,
          branchId: invite.branchId ?? null,
          role: invite.role,
          invitedById: invite.invitedById,
        },
      }),
    ]);

    this.logger.log(
      `Staff invite accepted: user ${staffUser.id} joined pharmacy ${invite.pharmacyId}`,
    );

    const tokens = await this.authService.generateTokenPair(
      staffUser.id,
      staffUser.email,
      staffUser.role,
    );

    return {
      message: `You have joined ${invite.pharmacy.name}${invite.branch ? ` — ${invite.branch.name}` : ''} as ${invite.role}`,
      user: {
        id: staffUser.id,
        email: staffUser.email,
        firstName: invite.firstName,
        lastName: invite.lastName,
        role: staffUser.role,
        fadaId: staffUser.fadaId,
      },
      tokens,
      pharmacyId: invite.pharmacyId,
      branchId: invite.branchId,
    };
  }

  async getStaff(requesterUserId: string, pharmacyId: string) {
    await this.assertOwnerOrOperator(requesterUserId, pharmacyId);

    const members = await this.prisma.pharmacyStaff.findMany({
      where: { pharmacyId, isActive: true },
      include: {
        user: { select: { id: true, email: true, fadaId: true, firstName: true, lastName: true, avatarUrl: true, isActive: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      fadaId: m.user.fadaId,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      branch: m.branch ?? null,
      isActive: m.isActive,
      joinedAt: m.joinedAt,
    }));
  }

  async removeStaff(
    requesterUserId: string,
    pharmacyId: string,
    staffUserId: string,
  ) {
    await this.assertOwnership(requesterUserId, pharmacyId);

    const membership = await this.prisma.pharmacyStaff.findUnique({
      where: { userId_pharmacyId: { userId: staffUserId, pharmacyId } },
    });
    if (!membership) {
      throw new NotFoundException('Staff member not found in this pharmacy');
    }

    await this.prisma.$transaction([
      this.prisma.pharmacyStaff.delete({
        where: { userId_pharmacyId: { userId: staffUserId, pharmacyId } },
      }),
      // Revert user role back to customer if they have no other staff memberships
      this.prisma.user.update({
        where: { id: staffUserId },
        data: { role: 'customer' },
      }),
    ]);

    return { message: 'Staff member removed from pharmacy' };
  }

  async getPendingInvites(requesterUserId: string, pharmacyId: string) {
    await this.assertOwnerOrOperator(requesterUserId, pharmacyId);

    return this.prisma.pharmacyStaffInvite.findMany({
      where: { pharmacyId, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        email: true,
        role: true,
        branchId: true,
        branch: { select: { name: true } },
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvite(requesterUserId: string, pharmacyId: string, inviteId: string) {
    await this.assertOwnership(requesterUserId, pharmacyId);

    const invite = await this.prisma.pharmacyStaffInvite.findFirst({
      where: { id: inviteId, pharmacyId },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    await this.prisma.pharmacyStaffInvite.delete({ where: { id: inviteId } });

    return { message: 'Invite revoked' };
  }

  // ─── Public Listing Helpers ─────────────────────────────────────────────────

  async getPublicPharmacyProfile(pharmacyId: string) {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId, isActive: true },
      select: {
        id: true,
        fadaId: true,
        name: true,
        description: true,
        phone: true,
        email: true,
        state: true,
        city: true,
        address: true,
        landmark: true,
        latitude: true,
        longitude: true,
        isVerified: true,
        cacVerified: true,
        reputationLevel: true,
        reputationPoints: true,
        images: {
          where: { isPrimary: true },
          select: { url: true },
          take: 1,
        },
        branches: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            address: true,
            latitude: true,
            longitude: true,
            isHeadBranch: true,
            workingHours: {
              orderBy: { dayOfWeek: 'asc' },
              select: {
                dayOfWeek: true,
                openTime: true,
                closeTime: true,
                isClosed: true,
              },
            },
          },
        },
        subscription: {
          select: { planId: true, status: true },
        },
      },
    });

    if (!pharmacy) throw new NotFoundException('Pharmacy not found');
    return pharmacy;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async getPharmacyWithDetails(pharmacyId: string) {
    return this.prisma.pharmacy.findUniqueOrThrow({
      where: { id: pharmacyId },
      include: {
        images: { orderBy: { isPrimary: 'desc' } },
        branches: {
          where: { isActive: true },
          include: {
            workingHours: { orderBy: { dayOfWeek: 'asc' } },
          },
          orderBy: [{ isHeadBranch: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
  }

  private async assertOwnership(
    pharmacistUserId: string,
    pharmacyId: string,
  ): Promise<void> {
    const profile = await this.prisma.pharmacistProfile.findFirst({
      where: { userId: pharmacistUserId, pharmacyId, roleInPharmacy: 'owner' },
    });
    if (!profile) {
      throw new ForbiddenException('Only the pharmacy owner can perform this action');
    }
  }

  private async assertOwnerOrOperator(
    pharmacistUserId: string,
    pharmacyId: string,
  ): Promise<void> {
    const profile = await this.prisma.pharmacistProfile.findFirst({
      where: {
        userId: pharmacistUserId,
        pharmacyId,
        roleInPharmacy: { in: ['owner', 'operator'] },
      },
    });
    if (!profile) {
      throw new ForbiddenException(
        'Only the pharmacy owner or operator can perform this action',
      );
    }
  }

  private async assertBranchBelongsToPharmacy(
    branchId: string,
    pharmacyId: string,
  ): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, pharmacyId },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found in this pharmacy');
    }
  }

  private generatePharmacyFadaId(): string {
    const digits = Math.floor(10_000_000 + Math.random() * 90_000_000)
      .toString()
      .substring(0, 7);
    return `PHM${digits}`;
  }
}
