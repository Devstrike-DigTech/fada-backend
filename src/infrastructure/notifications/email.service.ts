import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  /** null when RESEND_API_KEY is not set: the SDK throws on an empty key */
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey =
      this.configService.get<string>('notifications.resend.apiKey') ?? '';
    this.apiKey = apiKey;
    const fromName =
      this.configService.get<string>('notifications.resend.fromName') ?? 'FADA';
    const fromEmail =
      this.configService.get<string>('notifications.resend.from') ??
      'noreply@thefadaapp.com';

    this.from = `${fromName} <${fromEmail}>`;
    this.resend = this.isConfigured ? new Resend(apiKey) : null;
    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY not set — emails will not be sent.');
    }
  }

  /** False when RESEND_API_KEY is missing or still the placeholder. */
  get isConfigured(): boolean {
    return this.apiKey.length > 3 && this.apiKey !== 're_';
  }

  async send(options: SendEmailOptions): Promise<void> {
    if (!this.resend) {
      throw new Error('resend_not_configured');
    }
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    if (error) {
      this.logger.error(
        `Failed to send email to ${options.to}: ${error.message}`,
      );
      throw new Error(error.message);
    }

    this.logger.log(`Email sent to ${options.to} — "${options.subject}"`);
  }

  renderTemplate(templateId: string, data: Record<string, unknown>): string {
    switch (templateId) {
      case 'email-verification':
      case 'pharmacist-email-verification':
        return this.otpTemplate({
          firstName: this.str(data['firstName'], 'there'),
          otp: this.str(data['otp'], ''),
          expiresInMinutes: Number(data['expiresInMinutes'] ?? 10),
          heading:
            templateId === 'pharmacist-email-verification'
              ? 'Verify your pharmacist account'
              : 'Verify your FADA account',
        });

      case 'password-reset':
        return this.otpTemplate({
          firstName: this.str(data['firstName'], 'there'),
          otp: this.str(data['otp'], ''),
          expiresInMinutes: Number(data['expiresInMinutes'] ?? 10),
          heading: 'Reset your password',
          subtext:
            'Use the code below to reset your FADA password. If you did not request this, you can ignore this email.',
        });

      case 'staff-invite':
        return this.staffInviteTemplate({
          pharmacyName: this.str(data['pharmacyName'], 'a pharmacy'),
          role: this.str(data['role'], 'staff'),
          message: data['message'] ? this.str(data['message']) : null,
          token: this.str(data['token'], ''),
          expiresInHours: Number(data['expiresInHours'] ?? 48),
        });

      case 'pcn-verified':
        return this.pcnResultTemplate({
          firstName: this.str(data['firstName'], 'there'),
          licenseNumber: this.str(data['licenseNumber'], ''),
          success: true,
        });

      case 'pcn-failed':
        return this.pcnResultTemplate({
          firstName: this.str(data['firstName'], 'there'),
          licenseNumber: this.str(data['licenseNumber'], ''),
          success: false,
        });

      case 'welcome':
        return this.welcomeTemplate({
          firstName: this.str(data['firstName'], 'there'),
          fadaId: this.str(data['fadaId'], ''),
        });

      case 'cac-verified':
        return this.noticeTemplate({
          heading: 'Your CAC registration is verified',
          greeting: `Hi ${this.str(data['firstName'], 'there')},`,
          paragraphs: [
            `Good news: the CAC registration <strong>${this.esc(data['cacNumber'])}</strong> for <strong>${this.esc(data['pharmacyName'])}</strong> has been verified. Your pharmacy now shows as a registered business on FADA.`,
          ],
          tone: 'success',
        });

      case 'cac-failed':
        return this.noticeTemplate({
          heading: 'We could not verify your CAC registration',
          greeting: `Hi ${this.str(data['firstName'], 'there')},`,
          paragraphs: [
            `We were unable to verify the CAC registration <strong>${this.esc(data['cacNumber'])}</strong> for <strong>${this.esc(data['pharmacyName'])}</strong>.`,
            'Please check the RC number in your pharmacy profile, or reply to this email and our team will review it manually.',
          ],
          tone: 'danger',
        });

      /** Generic Phase 11 notification email: { heading, body, ctaLabel?, ctaUrl?, tone? } */
      case 'notification':
        return this.noticeTemplate({
          heading: this.str(data['heading'], 'FADA update'),
          greeting: data['firstName']
            ? `Hi ${this.esc(data['firstName'])},`
            : undefined,
          paragraphs: this.str(data['body'], '')
            .split(/\n{2,}/)
            .map((p) => this.esc(p)),
          ctaLabel: data['ctaLabel'] ? this.str(data['ctaLabel']) : undefined,
          ctaUrl: data['ctaUrl'] ? this.str(data['ctaUrl']) : undefined,
          tone:
            (data['tone'] as
              | 'info'
              | 'success'
              | 'warning'
              | 'danger'
              | undefined) ?? 'info',
        });

      default:
        this.logger.warn(
          `Unknown templateId "${templateId}", falling back to raw OTP template`,
        );
        return this.otpTemplate({
          firstName: this.str(data['firstName'], 'there'),
          otp: this.str(data['otp'], ''),
          expiresInMinutes: Number(data['expiresInMinutes'] ?? 10),
          heading: 'Your verification code',
        });
    }
  }

  private staffInviteTemplate(opts: {
    pharmacyName: string;
    role: string;
    message: string | null;
    token: string;
    expiresInHours: number;
  }): string {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    // The landing page opens the app at the invite (fadapharmacy://open/join/…)
    const acceptUrl = `${appUrl}/api/v1/pharmacy/staff/join/${opts.token}`;
    const roleLabel = opts.role === 'operator' ? 'Operator' : 'Staff Member';

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You've been invited to join ${opts.pharmacyName}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
          <tr>
            <td style="background:#0f766e;padding:32px 40px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">FADA</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 8px;font-size:20px;font-weight:600;color:#111827;">You've been invited!</p>
              <p style="margin:0 0 24px;font-size:15px;color:#6b7280;">
                You've been invited to join <strong>${opts.pharmacyName}</strong> on FADA as a <strong>${roleLabel}</strong>.
              </p>
              ${opts.message ? `<div style="background:#f9fafb;border-left:3px solid #0f766e;padding:12px 16px;border-radius:4px;margin:0 0 24px;"><p style="margin:0;font-size:14px;color:#374151;font-style:italic;">"${opts.message}"</p></div>` : ''}
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#0f766e;border-radius:8px;padding:14px 32px;text-align:center;">
                    <a href="${acceptUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Accept Invitation</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">
                Or copy this link into your browser:
              </p>
              <p style="margin:0 0 24px;font-size:12px;color:#6b7280;word-break:break-all;">${acceptUrl}</p>
              <p style="margin:0;font-size:13px;color:#9ca3af;">
                This invitation expires in <strong>${opts.expiresInHours} hours</strong>. You must be logged in to FADA to accept it.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                &copy; ${new Date().getFullYear()} FADA. If you weren't expecting this, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private pcnResultTemplate(opts: {
    firstName: string;
    licenseNumber: string;
    success: boolean;
  }): string {
    const heading = opts.success
      ? 'PCN license verified!'
      : 'PCN license verification failed';
    const color = opts.success ? '#0f766e' : '#dc2626';
    const icon = opts.success ? '✓' : '✗';
    const body = opts.success
      ? `Great news! Your PCN license <strong>${opts.licenseNumber}</strong> has been successfully verified. You can now complete your pharmacy setup on FADA.`
      : `We were unable to verify your PCN license <strong>${opts.licenseNumber}</strong> against the PCN registry. Please double-check your license number or contact our support team if you believe this is an error.`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
          <tr>
            <td style="background:${color};padding:32px 40px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">FADA</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:${opts.success ? '#f0fdf9' : '#fef2f2'};border:2px solid ${color};border-radius:50%;width:56px;height:56px;text-align:center;vertical-align:middle;">
                    <span style="font-size:26px;color:${color};line-height:56px;">${icon}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:20px;font-weight:600;color:#111827;">${heading}</p>
              <p style="margin:0 0 24px;font-size:15px;color:#6b7280;">Hi ${opts.firstName},</p>
              <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">${body}</p>
              ${!opts.success ? `<p style="margin:24px 0 0;font-size:13px;color:#9ca3af;">Need help? Reply to this email or contact us at support@thefadaapp.com</p>` : ''}
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                &copy; ${new Date().getFullYear()} FADA. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private welcomeTemplate(opts: { firstName: string; fadaId: string }): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to FADA</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">

          <!-- Header -->
          <tr>
            <td style="background:#0f766e;padding:32px 40px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">FADA</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 8px;font-size:20px;font-weight:600;color:#111827;">Welcome to FADA, ${opts.firstName}! 🎉</p>
              <p style="margin:0 0 32px;font-size:15px;color:#6b7280;">
                Your account is verified and ready to go. Here is your unique FADA ID — keep it handy for support and referrals.
              </p>

              <!-- FADA ID box -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="background:#f0fdf9;border:2px solid #0f766e;border-radius:10px;padding:16px 40px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:1.5px;color:#0f766e;text-transform:uppercase;">Your FADA ID</p>
                    <span style="font-size:26px;font-weight:700;letter-spacing:4px;color:#0f766e;">${opts.fadaId}</span>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;">
                You can now search for medications and pharmacies near you.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                &copy; ${new Date().getFullYear()} FADA. Questions? Reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private otpTemplate(opts: {
    firstName: string;
    otp: string;
    expiresInMinutes: number;
    heading: string;
    subtext?: string;
  }): string {
    const subtext =
      opts.subtext ??
      `Use the code below to verify your FADA account. It expires in ${opts.expiresInMinutes} minutes.`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.heading}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">

          <!-- Header -->
          <tr>
            <td style="background:#0f766e;padding:32px 40px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">FADA</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 8px;font-size:20px;font-weight:600;color:#111827;">${opts.heading}</p>
              <p style="margin:0 0 32px;font-size:15px;color:#6b7280;">Hi ${opts.firstName}, ${subtext}</p>

              <!-- OTP box -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="background:#f0fdf9;border:2px solid #0f766e;border-radius:10px;padding:18px 48px;text-align:center;">
                    <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#0f766e;">${opts.otp}</span>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;">
                This code expires in <strong>${opts.expiresInMinutes} minutes</strong>. Do not share it with anyone.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                &copy; ${new Date().getFullYear()} FADA. If you did not create an account, please ignore this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /** Template data is loosely typed; only primitives are rendered, anything else uses the fallback. */
  private str(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean')
      return String(value);
    return fallback;
  }

  /** Escapes user- or event-supplied text before it is placed in HTML. */
  private esc(value: unknown): string {
    return this.str(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Shared layout for informational emails. `paragraphs` may contain the
   * markup this class produces itself (e.g. <strong>); callers must escape
   * anything that came from users or events.
   */
  private noticeTemplate(opts: {
    heading: string;
    greeting?: string;
    paragraphs: string[];
    ctaLabel?: string;
    ctaUrl?: string;
    tone: 'info' | 'success' | 'warning' | 'danger';
  }): string {
    const colors = {
      info: '#0f766e',
      success: '#15803d',
      warning: '#b45309',
      danger: '#b91c1c',
    };
    const color = colors[opts.tone];
    const safeUrl =
      opts.ctaUrl && /^(https?:|fada:)/.test(opts.ctaUrl)
        ? opts.ctaUrl
        : undefined;
    const body = opts.paragraphs
      .filter(Boolean)
      .map(
        (p) =>
          `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${p}</p>`,
      )
      .join('');
    const cta =
      opts.ctaLabel && safeUrl
        ? `<table cellpadding="0" cellspacing="0" style="margin:8px 0 0;"><tr><td style="background:${color};border-radius:8px;"><a href="${this.esc(safeUrl)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${this.esc(opts.ctaLabel)}</a></td></tr></table>`
        : '';

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${this.esc(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
          <tr>
            <td style="background:${color};padding:32px 40px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">FADA</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;font-size:20px;font-weight:600;color:#111827;">${this.esc(opts.heading)}</p>
              ${opts.greeting ? `<p style="margin:0 0 16px;font-size:15px;color:#374151;">${opts.greeting}</p>` : ''}
              ${body}
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                &copy; ${new Date().getFullYear()} FADA. You can change which notifications you receive in the app settings.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
