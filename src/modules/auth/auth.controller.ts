import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { CurrentUser, CurrentUserData } from '@common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterPharmacistDto } from './dto/register-pharmacist.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { GoogleOAuthUser } from './strategies/google.strategy';
import { AppleOAuthUser } from './strategies/apple.strategy';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── Bootstrap Super Admin ──────────────────────────────────────────────────

  @Post('bootstrap-admin')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'One-time super admin creation (fails if any admin exists)' })
  @ApiResponse({ status: 201, description: 'Super admin created, tokens issued' })
  @ApiResponse({ status: 401, description: 'Invalid bootstrap secret' })
  @ApiResponse({ status: 409, description: 'Admin already exists' })
  bootstrapAdmin(@Body() dto: BootstrapAdminDto) {
    return this.authService.bootstrapAdmin(dto.email, dto.password, dto.secret);
  }

  // ─── Customer Registration ──────────────────────────────────────────────────

  @Post('register/customer')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new customer account' })
  @ApiResponse({ status: 201, description: 'OTP sent to email for verification' })
  @ApiResponse({ status: 409, description: 'Email or phone already registered' })
  registerCustomer(@Body() dto: RegisterCustomerDto) {
    return this.authService.registerCustomer(dto);
  }

  // ─── Pharmacist Registration ────────────────────────────────────────────────

  @Post('register/pharmacist')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new pharmacist account' })
  @ApiResponse({ status: 201, description: 'OTP sent, PCN verification initiated' })
  @ApiResponse({ status: 409, description: 'Email or phone already registered' })
  registerPharmacist(@Body() dto: RegisterPharmacistDto) {
    return this.authService.registerPharmacist(dto);
  }

  // ─── Email OTP Verification ─────────────────────────────────────────────────

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address with OTP code' })
  @ApiResponse({ status: 200, description: 'Email verified, tokens issued' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  verifyEmail(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyEmailOtp(dto.email, dto.otp);
  }

  // ─── Resend OTP ─────────────────────────────────────────────────────────────

  @Post('resend-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification OTP' })
  resendOtp(@Body() dto: ForgotPasswordDto) {
    return this.authService.resendOtp(dto.email);
  }

  // ─── Login ──────────────────────────────────────────────────────────────────

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful, tokens issued' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Email not verified or account deactivated' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // ─── Refresh Tokens ─────────────────────────────────────────────────────────

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and get new access token' })
  @ApiResponse({ status: 200, description: 'New token pair issued' })
  @ApiResponse({ status: 401, description: 'Invalid or revoked refresh token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  // ─── Logout ─────────────────────────────────────────────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  logout(
    @CurrentUser() user: CurrentUserData,
    @Body() body: Partial<RefreshTokenDto>,
  ) {
    return this.authService.logout(user.sub, body.refreshToken);
  }

  // ─── Forgot Password ────────────────────────────────────────────────────────

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset OTP' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  // ─── Reset Password ─────────────────────────────────────────────────────────

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using OTP from email' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.otp, dto.newPassword);
  }

  // ─── Change Password ────────────────────────────────────────────────────────

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Change password while authenticated' })
  changePassword(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  // ─── Current User ───────────────────────────────────────────────────────────

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  getMe(@CurrentUser() user: CurrentUserData) {
    return this.authService.getMe(user.sub);
  }

  // ─── Guest Token ────────────────────────────────────────────────────────────

  @Post('guest-token')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue a guest token for unauthenticated search/browsing',
    description:
      'Returns a guest token valid for 24h. Guests get 3 free searches/day. ' +
      'Pass the token in the x-guest-token header on subsequent requests.',
  })
  issueGuestToken() {
    return this.authService.issueGuestToken();
  }

  // ─── Google OAuth ───────────────────────────────────────────────────────────

  @Get('google')
  @Public()
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  googleLogin(): void {
    // Passport redirects automatically
  }

  @Get('google/callback')
  @Public()
  @UseGuards(AuthGuard('google'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Google OAuth callback — called by Google' })
  googleCallback(@Req() req: Request) {
    return this.authService.handleGoogleOAuth(req.user as GoogleOAuthUser);
  }

  // ─── Apple Sign-In ──────────────────────────────────────────────────────────

  @Post('apple')
  @Public()
  @UseGuards(AuthGuard('apple'))
  @ApiOperation({ summary: 'Initiate Apple Sign-In' })
  appleLogin(): void {
    // Passport redirects automatically
  }

  @Post('apple/callback')
  @Public()
  @UseGuards(AuthGuard('apple'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apple Sign-In callback — called by Apple' })
  appleCallback(@Req() req: Request) {
    return this.authService.handleAppleOAuth(req.user as AppleOAuthUser);
  }
}
