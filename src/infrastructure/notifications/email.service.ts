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
  private readonly resend: Resend;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('notifications.resend.apiKey') ?? '';
    const fromName = this.configService.get<string>('notifications.resend.fromName') ?? 'FADA';
    const fromEmail = this.configService.get<string>('notifications.resend.from') ?? 'noreply@thefadaapp.com';

    this.resend = new Resend(apiKey);
    this.from = `${fromName} <${fromEmail}>`;
  }

  async send(options: SendEmailOptions): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    if (error) {
      this.logger.error(`Failed to send email to ${options.to}: ${error.message}`);
      throw new Error(error.message);
    }

    this.logger.log(`Email sent to ${options.to} — "${options.subject}"`);
  }

  renderTemplate(templateId: string, data: Record<string, unknown>): string {
    switch (templateId) {
      case 'email-verification':
      case 'pharmacist-email-verification':
        return this.otpTemplate({
          firstName: String(data['firstName'] ?? 'there'),
          otp: String(data['otp'] ?? ''),
          expiresInMinutes: Number(data['expiresInMinutes'] ?? 10),
          heading: templateId === 'pharmacist-email-verification'
            ? 'Verify your pharmacist account'
            : 'Verify your FADA account',
        });

      case 'password-reset':
        return this.otpTemplate({
          firstName: String(data['firstName'] ?? 'there'),
          otp: String(data['otp'] ?? ''),
          expiresInMinutes: Number(data['expiresInMinutes'] ?? 10),
          heading: 'Reset your password',
          subtext: 'Use the code below to reset your FADA password. If you did not request this, you can ignore this email.',
        });

      case 'pcn-verified':
        return this.pcnResultTemplate({
          firstName: String(data['firstName'] ?? 'there'),
          licenseNumber: String(data['licenseNumber'] ?? ''),
          success: true,
        });

      case 'pcn-failed':
        return this.pcnResultTemplate({
          firstName: String(data['firstName'] ?? 'there'),
          licenseNumber: String(data['licenseNumber'] ?? ''),
          success: false,
        });

      case 'welcome':
        return this.welcomeTemplate({
          firstName: String(data['firstName'] ?? 'there'),
          fadaId: String(data['fadaId'] ?? ''),
        });

      default:
        this.logger.warn(`Unknown templateId "${templateId}", falling back to raw OTP template`);
        return this.otpTemplate({
          firstName: String(data['firstName'] ?? 'there'),
          otp: String(data['otp'] ?? ''),
          expiresInMinutes: Number(data['expiresInMinutes'] ?? 10),
          heading: 'Your verification code',
        });
    }
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
    const subtext = opts.subtext ?? `Use the code below to verify your FADA account. It expires in ${opts.expiresInMinutes} minutes.`;

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
}
