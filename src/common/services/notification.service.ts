import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailService, EmailOptions } from './email.service';
import twilio from 'twilio';
import { InAppNotificationEntity } from '../entities/in-app-notification.entity';

export interface InAppNotification {
  userId: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, any>;
}

export interface SmsOptions {
  to: string; // E.164 format e.g. +1234567890
  body: string;
}

export interface PushOptions {
  deviceToken: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface NotificationResult {
  channel: 'email' | 'sms' | 'push' | 'in_app';
  success: boolean;
  error?: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly twilioClient: ReturnType<typeof twilio> | null = null;
  private readonly twilioFrom: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    @InjectRepository(InAppNotificationEntity)
    private readonly inAppRepo: Repository<InAppNotificationEntity>,
  ) {
    const twilioSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const twilioToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.twilioFrom = this.configService.get<string>('TWILIO_PHONE_NUMBER', '');

    if (twilioSid && twilioToken) {
      this.twilioClient = twilio(twilioSid, twilioToken);
      this.logger.log('Twilio SMS service initialized');
    } else {
      this.logger.warn('Twilio not configured — SMS notifications disabled');
    }
  }

  // ─────────────────────────────────────────────────────
  // EMAIL
  // ─────────────────────────────────────────────────────

  async sendEmail(options: EmailOptions): Promise<NotificationResult> {
    try {
      await this.emailService.sendEmail(options);
      return { channel: 'email', success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Email notification failed: ${error}`);
      return { channel: 'email', success: false, error };
    }
  }

  // ─────────────────────────────────────────────────────
  // SMS
  // ─────────────────────────────────────────────────────

  async sendSms(options: SmsOptions): Promise<NotificationResult> {
    if (!this.twilioClient) {
      this.logger.warn(`SMS skipped (Twilio not configured): to=${options.to}`);
      return { channel: 'sms', success: false, error: 'Twilio not configured' };
    }

    try {
      await this.twilioClient.messages.create({
        from: this.twilioFrom,
        to: options.to,
        body: options.body,
      });
      this.logger.log(`SMS sent to ${options.to}`);
      return { channel: 'sms', success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMS notification failed (${options.to}): ${error}`);
      return { channel: 'sms', success: false, error };
    }
  }

  // ─────────────────────────────────────────────────────
  // IN-APP
  // ─────────────────────────────────────────────────────

  async sendInApp(notification: InAppNotification): Promise<NotificationResult> {
    try {
      await this.inAppRepo.save(
        this.inAppRepo.create({
          userId: notification.userId,
          title: notification.title,
          body: notification.body,
          type: notification.type,
          data: notification.data ?? null,
        }),
      );
      this.logger.debug(`In-app notification saved for user ${notification.userId}: "${notification.title}"`);
      return { channel: 'in_app', success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`In-app notification save failed for user ${notification.userId}: ${error}`);
      return { channel: 'in_app', success: false, error };
    }
  }

  async getInAppNotifications(userId: string, limit = 20): Promise<InAppNotification[]> {
    const rows = await this.inAppRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map((r) => ({
      userId: r.userId,
      title: r.title,
      body: r.body,
      type: r.type,
      data: r.data ?? undefined,
    }));
  }

  async clearInAppNotifications(userId: string): Promise<void> {
    await this.inAppRepo.delete({ userId });
  }

  // ─────────────────────────────────────────────────────
  // PUSH (placeholder — wire to FCM/APNs as needed)
  // ─────────────────────────────────────────────────────

  async sendPush(options: PushOptions): Promise<NotificationResult> {
    // FCM integration not yet configured — callers must check success: false.
    this.logger.warn(`Push notification not delivered (FCM not configured): ${options.title} → token=${options.deviceToken.slice(0, 8)}...`);
    return { channel: 'push', success: false, error: 'FCM not configured' };
  }

  // ─────────────────────────────────────────────────────
  // MULTI-CHANNEL SEND
  // ─────────────────────────────────────────────────────

  async sendMultiChannel(
    channels: Array<'email' | 'sms' | 'in_app' | 'push'>,
    payload: {
      email?: EmailOptions;
      sms?: SmsOptions;
      inApp?: InAppNotification;
      push?: PushOptions;
    },
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    for (const channel of channels) {
      switch (channel) {
        case 'email':
          if (payload.email) results.push(await this.sendEmail(payload.email));
          break;
        case 'sms':
          if (payload.sms) results.push(await this.sendSms(payload.sms));
          break;
        case 'in_app':
          if (payload.inApp) results.push(await this.sendInApp(payload.inApp));
          break;
        case 'push':
          if (payload.push) results.push(await this.sendPush(payload.push));
          break;
      }
    }

    return results;
  }
}
