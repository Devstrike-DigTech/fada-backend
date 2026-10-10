import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SmsResult {
  messageId?: string;
  raw?: unknown;
}

/**
 * Termii SMS (Nigeria). Numbers are normalised to international format
 * (234…) before sending. Throws on provider errors so the queue can retry.
 */
@Injectable()
export class TermiiService {
  private readonly logger = new Logger(TermiiService.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly senderId: string;
  private readonly channel: string;
  private readonly defaultCountryCode: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('notifications.termii.apiKey') ?? '';
    this.apiUrl =
      this.config.get<string>('notifications.termii.apiUrl') ??
      'https://api.ng.termii.com/api';
    this.senderId =
      this.config.get<string>('notifications.termii.senderId') ?? 'FADA';
    this.channel =
      this.config.get<string>('notifications.termii.channel') ?? 'generic';
    this.defaultCountryCode =
      this.config.get<string>('notifications.defaultCountryCode') ?? '234';
    if (!this.isConfigured) {
      this.logger.warn(
        'TERMII_API_KEY not set — SMS notifications are disabled.',
      );
    }
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** 0803… → 234803…, +234… → 234… ; returns null when it cannot be a phone number */
  normalisePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let digits = raw.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) digits = digits.slice(1);
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) {
      digits = this.defaultCountryCode + digits.slice(1);
    } else if (digits.length === 10) {
      digits = this.defaultCountryCode + digits;
    }
    return /^\d{11,15}$/.test(digits) ? digits : null;
  }

  async send(to: string, message: string): Promise<SmsResult> {
    if (!this.isConfigured) throw new Error('termii_not_configured');
    const phone = this.normalisePhone(to);
    if (!phone) throw new Error(`invalid_phone:${to}`);

    const res = await fetch(`${this.apiUrl}/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        to: phone,
        from: this.senderId,
        sms: message.slice(0, 480), // 3 segments max
        type: 'plain',
        channel: this.channel,
      }),
    });

    const json = (await res.json().catch(() => null)) as {
      message_id?: string;
      message?: string;
      code?: string;
    } | null;

    if (!res.ok || !json || (json.code && json.code !== 'ok')) {
      const reason = json?.message ?? `HTTP ${res.status}`;
      this.logger.error(`Termii send to ${phone} failed: ${reason}`);
      throw new Error(`termii_error:${reason}`);
    }
    this.logger.log(`SMS sent to ${phone} (${json.message_id ?? 'no id'})`);
    return { messageId: json.message_id, raw: json };
  }
}
