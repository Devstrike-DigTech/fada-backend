import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '@infra/database/prisma.service';
import { RedisService } from '@infra/redis/redis.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { EVENTS } from '@common/types/events.types';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterPharmacistDto } from './dto/register-pharmacist.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleOAuthUser } from './strategies/google.strategy';
import { AppleOAuthUser } from './strategies/apple.strategy';

// ─── Constants ────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12;
const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const GUEST_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const GUEST_DAILY_SEARCH_LIMIT = 3;

// ─── Redis key helpers ────────────────────────────────────────────────────────
const REDIS_KEYS = {
  otp: (email: string) => `auth:otp:${email}`,
  refreshToken: (userId: string, tokenId: string) =>
    `auth:refresh:${userId}:${tokenId}`,
  guestToken: (token: string) => `auth:guest:${token}`,
  guestSearchCount: (token: string) => `auth:guest:searches:${token}`,
  blacklistedToken: (jti: string) => `auth:blacklist:${jti}`,
};

// ─── Response shapes ──────────────────────────────────────────────────────────
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isEmailVerified: boolean;
    fadaId: string;
  };
  tokens: AuthTokens;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly eventBus: EventBusService,
  ) {}

  // ─── Register Customer ──────────────────────────────────────────────────────

  async registerCustomer(dto: RegisterCustomerDto): Promise<{ message: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const phoneExists = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (phoneExists) {
      throw new ConflictException('An account with this phone number already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const fadaId = this.generateFadaId('customer');

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          phone: dto.phone,
          passwordHash: hashedPassword,
          role: 'customer',
          fadaId,
        },
      });

      await tx.customerProfile.create({
        data: {
          userId: newUser.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          referralCode: this.generateReferralCode(dto.firstName),
        },
      });

      return newUser;
    });

    // Send email OTP for verification
    const otp = this.generateOtp();
    await this.redis.set(REDIS_KEYS.otp(user.email), otp, OTP_TTL_SECONDS);

    await this.eventBus.emit(EVENTS.AUTH.USER_REGISTERED, {
      userId: user.id,
      email: user.email,
      role: user.role,
      registeredAt: new Date(),
    });

    await this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
      to: user.email,
      subject: 'Verify your FADA account',
      templateId: 'email-verification',
      templateData: {
        firstName: dto.firstName,
        otp,
        expiresInMinutes: 10,
      },
      userId: user.id,
    });

    this.logger.log(`Customer registered: ${user.id}`);
    return { message: 'Registration successful. Check your email for an OTP to verify your account.' };
  }

  // ─── Register Pharmacist ────────────────────────────────────────────────────

  async registerPharmacist(dto: RegisterPharmacistDto): Promise<{ message: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const phoneExists = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (phoneExists) {
      throw new ConflictException('An account with this phone number already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const fadaId = this.generateFadaId('pharmacist');

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          phone: dto.phone,
          passwordHash: hashedPassword,
          role: 'pharmacist',
          fadaId,
        },
      });

      await tx.pharmacistProfile.create({
        data: {
          userId: newUser.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          licenseType: dto.licenseType,
          licenseNumber: dto.licenseNumber,
          pcnVerified: false,
        },
      });

      return newUser;
    });

    // Trigger PCN verification via queue
    await this.eventBus.emit(EVENTS.PHARMACY.PCN_VERIFICATION_REQUESTED, {
      pharmacistId: user.id,
      licenseNumber: dto.licenseNumber,
      licenseType: dto.licenseType,
    });

    // Send email OTP for account verification
    const otp = this.generateOtp();
    await this.redis.set(REDIS_KEYS.otp(user.email), otp, OTP_TTL_SECONDS);

    await this.eventBus.emit(EVENTS.AUTH.USER_REGISTERED, {
      userId: user.id,
      email: user.email,
      role: user.role,
      registeredAt: new Date(),
    });

    await this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
      to: user.email,
      subject: 'Verify your FADA Pharmacist account',
      templateId: 'pharmacist-email-verification',
      templateData: {
        firstName: dto.firstName,
        otp,
        expiresInMinutes: 10,
      },
      userId: user.id,
    });

    this.logger.log(`Pharmacist registered: ${user.id}`);
    return {
      message:
        'Registration successful. Check your email for an OTP. Your PCN license will be verified separately.',
    };
  }

  // ─── Verify Email OTP ───────────────────────────────────────────────────────

  async verifyEmailOtp(email: string, otp: string): Promise<AuthResponse> {
    const storedOtp = await this.redis.get(REDIS_KEYS.otp(email.toLowerCase()));

    if (!storedOtp) {
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }
    if (storedOtp !== otp) {
      throw new BadRequestException('Invalid OTP');
    }

    const user = await this.prisma.user.update({
      where: { email: email.toLowerCase() },
      data: { isEmailVerified: true, isActive: true },
      include: {
        customerProfile: true,
        pharmacistProfile: true,
      },
    });

    await this.redis.del(REDIS_KEYS.otp(email.toLowerCase()));

    await this.eventBus.emit(EVENTS.AUTH.USER_VERIFIED, {
      userId: user.id,
      email: user.email,
      verifiedAt: new Date(),
    });

    const tokens = await this.generateTokenPair(user.id, user.email, user.role);
    const profile = user.customerProfile ?? user.pharmacistProfile;

    await this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
      to: user.email,
      subject: 'Welcome to FADA!',
      templateId: 'welcome',
      templateData: {
        firstName: profile?.firstName ?? 'there',
        fadaId: user.fadaId,
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: profile?.firstName ?? '',
        lastName: profile?.lastName ?? '',
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        fadaId: user.fadaId,
      },
      tokens,
    };
  }

  // ─── Resend OTP ─────────────────────────────────────────────────────────────

  async resendOtp(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        customerProfile: true,
        pharmacistProfile: true,
      },
    });

    if (!user) {
      // Don't reveal user existence
      return { message: 'If this email is registered, an OTP has been sent.' };
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    const otp = this.generateOtp();
    await this.redis.set(REDIS_KEYS.otp(user.email), otp, OTP_TTL_SECONDS);

    const profile = user.customerProfile ?? user.pharmacistProfile;
    await this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
      to: user.email,
      subject: 'Your FADA verification code',
      templateId: 'email-verification',
      templateData: {
        firstName: profile?.firstName ?? 'User',
        otp,
        expiresInMinutes: 10,
      },
      userId: user.id,
    });

    return { message: 'If this email is registered, an OTP has been sent.' };
  }

  // ─── Login ──────────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        customerProfile: true,
        pharmacistProfile: true,
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isEmailVerified) {
      throw new ForbiddenException(
        'Please verify your email address before logging in',
      );
    }

    if (!user.isActive) {
      throw new ForbiddenException('Your account has been deactivated');
    }

    await this.eventBus.emit(EVENTS.AUTH.USER_LOGGED_IN, {
      userId: user.id,
      loggedInAt: new Date(),
    });

    const tokens = await this.generateTokenPair(user.id, user.email, user.role);
    const profile = user.customerProfile ?? user.pharmacistProfile;

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: profile?.firstName ?? '',
        lastName: profile?.lastName ?? '',
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        fadaId: user.fadaId,
      },
      tokens,
    };
  }

  // ─── Refresh Token ──────────────────────────────────────────────────────────

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    let payload: { sub: string; email: string; role: string; jti: string };

    try {
      payload = this.jwtService.verify<typeof payload>(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const storedToken = await this.redis.get(
      REDIS_KEYS.refreshToken(payload.sub, payload.jti),
    );

    if (!storedToken || storedToken !== refreshToken) {
      throw new UnauthorizedException(
        'Refresh token has been revoked or does not exist',
      );
    }

    // Rotate — delete old, issue new
    await this.redis.del(REDIS_KEYS.refreshToken(payload.sub, payload.jti));

    const tokens = await this.generateTokenPair(
      payload.sub,
      payload.email,
      payload.role,
    );

    await this.eventBus.emit(EVENTS.AUTH.REFRESH_TOKEN_ROTATED, {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      loggedInAt: new Date(),
    });

    return tokens;
  }

  // ─── Logout ─────────────────────────────────────────────────────────────────

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      try {
        const payload = this.jwtService.decode<{ jti?: string }>(refreshToken);
        if (payload?.jti) {
          await this.redis.del(REDIS_KEYS.refreshToken(userId, payload.jti));
        }
      } catch {
        // Silently fail — token may already be expired
      }
    }
  }

  // ─── Forgot Password ────────────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        customerProfile: true,
        pharmacistProfile: true,
      },
    });

    if (!user) {
      return {
        message: 'If this email is registered, you will receive a reset code.',
      };
    }

    const otp = this.generateOtp();
    await this.redis.set(
      `auth:pwd-reset:${email.toLowerCase()}`,
      otp,
      OTP_TTL_SECONDS,
    );

    await this.eventBus.emit(EVENTS.AUTH.PASSWORD_RESET_REQUESTED, {
      userId: user.id,
      email: user.email,
      otpCode: otp,
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    });

    const profile = user.customerProfile ?? user.pharmacistProfile;
    await this.eventBus.emit(EVENTS.NOTIFICATION.EMAIL_SEND_REQUESTED, {
      to: user.email,
      subject: 'Reset your FADA password',
      templateId: 'password-reset',
      templateData: {
        firstName: profile?.firstName ?? 'User',
        otp,
        expiresInMinutes: 10,
      },
      userId: user.id,
    });

    return {
      message: 'If this email is registered, you will receive a reset code.',
    };
  }

  // ─── Reset Password ─────────────────────────────────────────────────────────

  async resetPassword(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const key = `auth:pwd-reset:${email.toLowerCase()}`;
    const storedOtp = await this.redis.get(key);

    if (!storedOtp || storedOtp !== otp) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    const user = await this.prisma.user.update({
      where: { email: email.toLowerCase() },
      data: { passwordHash: hashedPassword },
    });

    await this.redis.del(key);

    await this.eventBus.emit(EVENTS.AUTH.PASSWORD_RESET_COMPLETED, {
      userId: user.id,
      email: user.email,
      role: user.role,
      loggedInAt: new Date(),
    });

    return { message: 'Password reset successfully. You can now log in.' };
  }

  // ─── Change Password ────────────────────────────────────────────────────────

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.passwordHash) {
      throw new NotFoundException('User not found');
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashedPassword },
    });

    return { message: 'Password changed successfully' };
  }

  // ─── Google OAuth Handler ───────────────────────────────────────────────────

  async handleGoogleOAuth(googleUser: GoogleOAuthUser): Promise<AuthResponse> {
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { googleId: googleUser.googleId },
          { email: googleUser.email.toLowerCase() },
        ],
      },
      include: {
        customerProfile: true,
        pharmacistProfile: true,
      },
    });

    if (!user) {
      // Auto-register as customer via OAuth
      const fadaId = this.generateFadaId('customer');
      user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: googleUser.email.toLowerCase(),
            googleId: googleUser.googleId,
            role: 'customer',
            fadaId,
            isEmailVerified: true,
            isActive: true,
          },
        });

        await tx.customerProfile.create({
          data: {
            userId: newUser.id,
            firstName: googleUser.firstName,
            lastName: googleUser.lastName,
            avatarUrl: googleUser.avatarUrl,
            referralCode: this.generateReferralCode(googleUser.firstName),
          },
        });

        return tx.user.findUniqueOrThrow({
          where: { id: newUser.id },
          include: { customerProfile: true, pharmacistProfile: true },
        });
      });

      await this.eventBus.emit(EVENTS.AUTH.USER_REGISTERED, {
        userId: user.id,
        email: user.email,
        role: user.role,
        registeredAt: new Date(),
      });
    } else if (!user.googleId) {
      // Link Google to existing email account
      await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId: googleUser.googleId },
      });
    }

    if (!user.isActive) {
      throw new ForbiddenException('Your account has been deactivated');
    }

    await this.eventBus.emit(EVENTS.AUTH.USER_LOGGED_IN, {
      userId: user.id,
      loggedInAt: new Date(),
    });

    const tokens = await this.generateTokenPair(user.id, user.email, user.role);
    const profile = user.customerProfile ?? user.pharmacistProfile;

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: profile?.firstName ?? googleUser.firstName,
        lastName: profile?.lastName ?? googleUser.lastName,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        fadaId: user.fadaId,
      },
      tokens,
    };
  }

  // ─── Apple OAuth Handler ────────────────────────────────────────────────────

  async handleAppleOAuth(appleUser: AppleOAuthUser): Promise<AuthResponse> {
    let user = await this.prisma.user.findFirst({
      where: { appleId: appleUser.appleId },
      include: {
        customerProfile: true,
        pharmacistProfile: true,
      },
    });

    if (!user && appleUser.email) {
      user = await this.prisma.user.findUnique({
        where: { email: appleUser.email.toLowerCase() },
        include: { customerProfile: true, pharmacistProfile: true },
      });
    }

    if (!user) {
      const fadaId = this.generateFadaId('customer');
      const firstName = appleUser.firstName ?? 'FADA';
      const lastName = appleUser.lastName ?? 'User';

      user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: appleUser.email?.toLowerCase() ?? `${appleUser.appleId}@apple.fada`,
            appleId: appleUser.appleId,
            role: 'customer',
            fadaId,
            isEmailVerified: !!appleUser.email,
            isActive: true,
          },
        });

        await tx.customerProfile.create({
          data: {
            userId: newUser.id,
            firstName,
            lastName,
            referralCode: this.generateReferralCode(firstName),
          },
        });

        return tx.user.findUniqueOrThrow({
          where: { id: newUser.id },
          include: { customerProfile: true, pharmacistProfile: true },
        });
      });

      await this.eventBus.emit(EVENTS.AUTH.USER_REGISTERED, {
        userId: user.id,
        email: user.email,
        role: user.role,
        registeredAt: new Date(),
      });
    } else if (!user.appleId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { appleId: appleUser.appleId },
      });
    }

    if (!user.isActive) {
      throw new ForbiddenException('Your account has been deactivated');
    }

    const tokens = await this.generateTokenPair(user.id, user.email, user.role);
    const profile = user.customerProfile ?? user.pharmacistProfile;

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: profile?.firstName ?? appleUser.firstName ?? 'FADA',
        lastName: profile?.lastName ?? appleUser.lastName ?? 'User',
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        fadaId: user.fadaId,
      },
      tokens,
    };
  }

  // ─── Guest Token ────────────────────────────────────────────────────────────

  async issueGuestToken(): Promise<{
    guestToken: string;
    remainingSearches: number;
    expiresInSeconds: number;
  }> {
    const token = `guest_${uuidv4().replace(/-/g, '')}`;
    const key = REDIS_KEYS.guestToken(token);
    const searchCountKey = REDIS_KEYS.guestSearchCount(token);

    await this.redis.set(key, '1', GUEST_TOKEN_TTL_SECONDS);
    await this.redis.set(
      searchCountKey,
      '0',
      GUEST_TOKEN_TTL_SECONDS,
    );

    return {
      guestToken: token,
      remainingSearches: GUEST_DAILY_SEARCH_LIMIT,
      expiresInSeconds: GUEST_TOKEN_TTL_SECONDS,
    };
  }

  async validateGuestToken(
    token: string,
  ): Promise<{ valid: boolean; remainingSearches: number }> {
    const exists = await this.redis.exists(REDIS_KEYS.guestToken(token));
    if (!exists) {
      return { valid: false, remainingSearches: 0 };
    }

    const countStr =
      (await this.redis.get(REDIS_KEYS.guestSearchCount(token))) ?? '0';
    const count = parseInt(countStr, 10);
    const remaining = Math.max(0, GUEST_DAILY_SEARCH_LIMIT - count);

    return { valid: true, remainingSearches: remaining };
  }

  async incrementGuestSearchCount(
    token: string,
  ): Promise<{ allowed: boolean; remaining: number }> {
    const exists = await this.redis.exists(REDIS_KEYS.guestToken(token));
    if (!exists) {
      return { allowed: false, remaining: 0 };
    }

    const count = await this.redis.incr(REDIS_KEYS.guestSearchCount(token));
    const remaining = Math.max(0, GUEST_DAILY_SEARCH_LIMIT - count);

    if (count > GUEST_DAILY_SEARCH_LIMIT) {
      await this.eventBus.emit(EVENTS.SEARCH.GUEST_LIMIT_REACHED, {
        guestToken: token,
        query: '',
        radiusKm: 0,
        resultCount: 0,
        searchedAt: new Date(),
      });
      return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining };
  }

  // ─── Token Generation ───────────────────────────────────────────────────────

  async generateTokenPair(
    userId: string,
    email: string,
    role: string,
  ): Promise<AuthTokens> {
    const jti = uuidv4();
    const accessExpiresIn =
      this.configService.get<string>('jwt.accessExpiresIn') ?? '15m';
    const refreshExpiresIn =
      this.configService.get<string>('jwt.refreshExpiresIn') ?? '30d';

    const accessToken = this.jwtService.sign(
      { sub: userId, email, role },
      {
        secret: this.configService.get<string>('jwt.accessSecret'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expiresIn: accessExpiresIn as any,
      },
    );

    const refreshToken = this.jwtService.sign(
      { sub: userId, email, role, jti },
      {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expiresIn: refreshExpiresIn as any,
      },
    );

    // Store refresh token in Redis for rotation validation
    await this.redis.set(
      REDIS_KEYS.refreshToken(userId, jti),
      refreshToken,
      REFRESH_TOKEN_TTL_SECONDS,
    );

    // Parse "15m" / "30d" to seconds for response
    const expiresIn = this.parseExpiresInToSeconds(accessExpiresIn);

    return { accessToken, refreshToken, expiresIn };
  }

  // ─── Bootstrap Super Admin ──────────────────────────────────────────────────

  async bootstrapAdmin(
    email: string,
    password: string,
    secret: string,
  ): Promise<AuthResponse> {
    const expectedSecret = this.configService.get<string>('app.adminBootstrapSecret');

    if (!expectedSecret || secret !== expectedSecret) {
      throw new UnauthorizedException('Invalid bootstrap secret');
    }

    const adminExists = await this.prisma.user.findFirst({
      where: { role: 'admin' },
    });

    if (adminExists) {
      throw new ConflictException(
        'A super admin already exists. Use the admin portal to create additional admins.',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const fadaId = this.generateFadaId('admin');

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

    this.logger.log(`Super admin bootstrapped: ${user.id}`);

    const tokens = await this.generateTokenPair(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: 'Super',
        lastName: 'Admin',
        role: user.role,
        isEmailVerified: true,
        fadaId: user.fadaId,
      },
      tokens,
    };
  }

  // ─── Me (current user) ──────────────────────────────────────────────────────

  async getMe(userId: string): Promise<AuthResponse['user']> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        customerProfile: true,
        pharmacistProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const profile = user.customerProfile ?? user.pharmacistProfile;

    return {
      id: user.id,
      email: user.email,
      firstName: profile?.firstName ?? '',
      lastName: profile?.lastName ?? '',
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      fadaId: user.fadaId,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateFadaId(type: 'customer' | 'pharmacist' | 'admin'): string {
    const prefix =
      type === 'customer' ? 'CUS' : type === 'pharmacist' ? 'PHM' : 'ADM';
    const digits = Math.floor(10_000_000 + Math.random() * 90_000_000)
      .toString()
      .substring(0, 7);
    return `${prefix}${digits}`;
  }

  private generateReferralCode(firstName: string): string {
    const upper = firstName.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${upper}${rand}`;
  }

  private parseExpiresInToSeconds(expiresIn: string): number {
    const match = /^(\d+)([smhd])$/.exec(expiresIn);
    if (!match) return 900;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    return value * (multipliers[unit] ?? 60);
  }
}
