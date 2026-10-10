import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { AuthService } from '@modules/auth/auth.service';
import { CreateMarketerDto, MarketerQueryDto } from './dto/marketing.dto';

const BCRYPT_ROUNDS = 12;
// No look-alike characters: admins read these out or type them in a chat
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

const MARKETER_SELECT = {
  id: true,
  fadaId: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type MarketerRow = Prisma.UserGetPayload<{ select: typeof MARKETER_SELECT }>;

/**
 * Marketers are staff accounts, not self-service sign-ups: an admin creates
 * one and hands over a temporary password, which the app forces the marketer
 * to change on first login.
 */
@Injectable()
export class MarketerAccountsService {
  private readonly logger = new Logger(MarketerAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async list(query: MarketerQueryDto) {
    const where: Prisma.UserWhereInput = { role: 'marketer' };
    if (query.active !== undefined) where.isActive = query.active;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.take,
        select: MARKETER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);
    const counts = await this.prisma.pharmacyProspect.groupBy({
      by: ['addedById'],
      where: { addedById: { in: users.map((u) => u.id) }, deletedAt: null },
      _count: { _all: true },
    });
    const byUser = new Map(counts.map((c) => [c.addedById, c._count._all]));
    return {
      items: users.map((u) => ({
        ...this.present(u),
        prospectsAdded: byUser.get(u.id) ?? 0,
      })),
      meta: {
        page: query.page ?? 1,
        limit: query.take,
        total,
        totalPages: Math.ceil(total / query.take),
      },
    };
  }

  async create(dto: CreateMarketerDto) {
    const email = dto.email.toLowerCase();
    const clash = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, ...(dto.phone ? [{ phone: dto.phone }] : [])],
      },
      select: { email: true },
    });
    if (clash) {
      throw new ConflictException(
        clash.email === email
          ? 'An account with this email already exists'
          : 'An account with this phone number already exists',
      );
    }

    const temporaryPassword = this.generatePassword();
    const user = await this.prisma.user.create({
      data: {
        email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS),
        role: 'marketer',
        fadaId: await this.uniqueFadaId(),
        isEmailVerified: true,
        isActive: true,
        mustChangePassword: true,
      },
      select: MARKETER_SELECT,
    });
    this.logger.log(`Marketer account created: ${user.id}`);
    // Shown to the admin exactly once; it is never stored in clear
    return { ...this.present(user), temporaryPassword };
  }

  /** New temporary password; every existing session is signed out. */
  async resetPassword(id: string) {
    const user = await this.findMarketer(id);
    const temporaryPassword = this.generatePassword();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS),
        mustChangePassword: true,
      },
    });
    await this.auth.revokeAllRefreshTokens(user.id);
    return { id: user.id, temporaryPassword };
  }

  /** Deactivated marketers cannot sign in; their history is kept. */
  async setActive(id: string, isActive: boolean) {
    const user = await this.findMarketer(id);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { isActive },
      select: MARKETER_SELECT,
    });
    if (!isActive) await this.auth.revokeAllRefreshTokens(user.id);
    return this.present(updated);
  }

  private present(u: MarketerRow) {
    return {
      id: u.id,
      fadaId: u.fadaId,
      email: u.email,
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      phone: u.phone,
      isActive: u.isActive,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt,
    };
  }

  private async findMarketer(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.role !== 'marketer') {
      throw new NotFoundException('Marketer not found');
    }
    return user;
  }

  private generatePassword(): string {
    let out = '';
    for (let i = 0; i < 12; i++) {
      out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    return out;
  }

  private async uniqueFadaId(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `MKT${randomInt(1_000_000, 10_000_000)}`;
      const taken = await this.prisma.user.findUnique({
        where: { fadaId: id },
        select: { id: true },
      });
      if (!taken) return id;
    }
    throw new ConflictException('Could not allocate a FADA id; try again');
  }
}
