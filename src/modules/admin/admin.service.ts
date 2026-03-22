import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { PcnRegistryService } from '@infra/registries/pcn-registry.service';
import { EVENTS } from '@common/types/events.types';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly pcnRegistry: PcnRegistryService,
  ) {}

  // ─── Create Admin ───────────────────────────────────────────────────────────

  async createAdmin(
    email: string,
    password: string,
  ): Promise<{ id: string; email: string; fadaId: string; role: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const fadaId = this.generateAdminFadaId();

    const user = await this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: hashedPassword,
        role: 'admin',
        fadaId,
        isEmailVerified: true,
        isActive: true,
      },
    });

    this.logger.log(`Admin created: ${user.id} by internal call`);

    return { id: user.id, email: user.email, fadaId: user.fadaId, role: user.role };
  }

  private generateAdminFadaId(): string {
    const digits = Math.floor(10_000_000 + Math.random() * 90_000_000)
      .toString()
      .substring(0, 7);
    return `ADM${digits}`;
  }

  // ─── Manual PCN Override ────────────────────────────────────────────────────

  async overridePcnVerification(
    pharmacistUserId: string,
    adminUserId: string,
    note?: string,
  ): Promise<{ message: string }> {
    const profile = await this.prisma.pharmacistProfile.findUnique({
      where: { userId: pharmacistUserId },
      include: { user: true },
    });

    if (!profile) {
      throw new NotFoundException('Pharmacist profile not found');
    }

    if (profile.pcnVerified) {
      throw new BadRequestException('PCN is already verified for this pharmacist');
    }

    await this.prisma.pharmacistProfile.update({
      where: { userId: pharmacistUserId },
      data: {
        pcnVerified: true,
        pcnVerifiedAt: new Date(),
        pcnVerificationSource: 'manual',
        pcnOverrideNote: note ?? null,
        pcnVerifiedById: adminUserId,
      },
    });

    this.logger.log(
      `Admin ${adminUserId} manually verified PCN for pharmacist ${pharmacistUserId}`,
    );

    this.eventBus.emit(EVENTS.PHARMACY.PCN_VERIFICATION_COMPLETED, {
      pharmacistId: pharmacistUserId,
      licenseNumber: profile.licenseNumber,
      isValid: true,
      verifiedAt: new Date(),
    });

    this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
      to: profile.user.email,
      subject: 'Your PCN license has been verified ✓',
      templateId: 'pcn-verified',
      templateData: {
        firstName: profile.firstName,
        licenseNumber: profile.licenseNumber,
      },
      userId: pharmacistUserId,
    });

    return { message: `PCN verification manually approved for pharmacist ${pharmacistUserId}` };
  }

  // ─── Retry Auto PCN Verification ────────────────────────────────────────────

  async retryPcnVerification(
    pharmacistUserId: string,
  ): Promise<{ message: string; found: boolean }> {
    const profile = await this.prisma.pharmacistProfile.findUnique({
      where: { userId: pharmacistUserId },
      include: { user: true },
    });

    if (!profile) {
      throw new NotFoundException('Pharmacist profile not found');
    }

    if (profile.pcnVerified) {
      throw new BadRequestException('PCN is already verified for this pharmacist');
    }

    let found = false;

    try {
      const result = await this.pcnRegistry.lookupLicense(profile.licenseNumber);
      found = result.found;
    } catch (err) {
      throw new BadRequestException(
        `PCN registry lookup failed: ${(err as Error).message}`,
      );
    }

    await this.prisma.pharmacistProfile.update({
      where: { userId: pharmacistUserId },
      data: {
        pcnVerified: found,
        pcnVerifiedAt: found ? new Date() : null,
        pcnVerificationSource: found ? 'auto' : null,
      },
    });

    if (found) {
      this.eventBus.emit(EVENTS.PHARMACY.PCN_VERIFICATION_COMPLETED, {
        pharmacistId: pharmacistUserId,
        licenseNumber: profile.licenseNumber,
        isValid: true,
        verifiedAt: new Date(),
      });

      this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
        to: profile.user.email,
        subject: 'Your PCN license has been verified ✓',
        templateId: 'pcn-verified',
        templateData: {
          firstName: profile.firstName,
          licenseNumber: profile.licenseNumber,
        },
        userId: pharmacistUserId,
      });
    }

    return {
      message: found
        ? 'PCN license found and verified'
        : 'PCN license not found in registry',
      found,
    };
  }

  // ─── List Unverified Pharmacists ────────────────────────────────────────────

  async listUnverifiedPharmacists(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [profiles, total] = await this.prisma.$transaction([
      this.prisma.pharmacistProfile.findMany({
        where: { pcnVerified: false },
        include: { user: { select: { id: true, email: true, fadaId: true, createdAt: true } } },
        orderBy: { user: { createdAt: 'desc' } },
        skip,
        take: limit,
      }),
      this.prisma.pharmacistProfile.count({ where: { pcnVerified: false } }),
    ]);

    return {
      data: profiles.map((p) => ({
        userId: p.userId,
        fadaId: p.user.fadaId,
        email: p.user.email,
        firstName: p.firstName,
        lastName: p.lastName,
        licenseNumber: p.licenseNumber,
        licenseType: p.licenseType,
        registeredAt: p.user.createdAt,
        pcnVerificationSource: p.pcnVerificationSource,
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }
}
