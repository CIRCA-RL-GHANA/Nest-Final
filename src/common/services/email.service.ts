import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, any>;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{
    content: string;
    filename: string;
    type?: string;
    disposition?: string;
  }>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly configured: boolean;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('email.sendgridApiKey');

    if (!apiKey) {
      this.logger.warn('SendGrid API key not configured. Email sending will be disabled.');
      this.configured = false;
    } else {
      sgMail.setApiKey(apiKey);
      this.configured = true;
      this.logger.log('SendGrid email service initialized');
    }

    this.fromEmail = this.configService.get<string>('email.from', 'noreply@genieinprompt.app');
    this.fromName = this.configService.get<string>('email.fromName', 'genie help');
  }

  /**
   * Send a simple email
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    if (!this.configured) {
      this.logger.warn(`Email skipped (SendGrid not configured): "${options.subject}"`);
      return;
    }
    try {
      const msg = {
        to: options.to,
        from: {
          email: this.fromEmail,
          name: this.fromName,
        },
        subject: options.subject,
        text: options.text,
        html: options.html,
        cc: options.cc,
        bcc: options.bcc,
        attachments: options.attachments,
      };

      await sgMail.send(msg as sgMail.MailDataRequired);
      this.logger.log(
        `Email sent successfully to ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Send email using SendGrid template
   */
  async sendTemplateEmail(options: EmailOptions & { templateId: string }): Promise<void> {
    if (!this.configured) {
      this.logger.warn(
        `Template email skipped (SendGrid not configured): template "${options.templateId}"`,
      );
      return;
    }
    try {
      const msg = {
        to: options.to,
        from: {
          email: this.fromEmail,
          name: this.fromName,
        },
        templateId: options.templateId,
        dynamicTemplateData: options.dynamicTemplateData || {},
        cc: options.cc,
        bcc: options.bcc,
      };

      await sgMail.send(msg as sgMail.MailDataRequired);
      this.logger.log(
        `Template email sent successfully to ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send template email: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Send OTP email
   */
  async sendOTP(email: string, otp: string, expiryMinutes: number = 5): Promise<void> {
    const subject = 'Your OTP Code';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your One-Time Password</h2>
        <p>Your OTP code is:</p>
        <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
          ${otp}
        </div>
        <p>This code will expire in ${expiryMinutes} minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
      </div>
    `;

    await this.sendEmail({ to: email, subject, html });
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(email: string, resetToken: string, resetUrl: string): Promise<void> {
    const subject = 'Password Reset Request';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Request</h2>
        <p>You requested to reset your password. Click the button below to reset it:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${resetUrl}</p>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
      </div>
    `;

    await this.sendEmail({ to: email, subject, html });
  }

  /**
   * Send welcome email
   */
  async sendWelcome(email: string, name: string): Promise<void> {
    const subject = 'Welcome to genie help!';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to genie help, ${name}!</h2>
        <p>Thank you for joining our platform. We're excited to have you on board!</p>
        <p>Get started by exploring our features and setting up your profile.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${this.configService.get('app.url', 'https://genieinprompt.app')}" style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Get Started
          </a>
        </div>
        <p>If you have any questions, feel free to reach out to our support team.</p>
        <p>Best regards,<br>The genie help Team</p>
      </div>
    `;

    await this.sendEmail({ to: email, subject, html });
  }

  /**
   * Send verification email
   */
  async sendVerification(email: string, verificationUrl: string): Promise<void> {
    const subject = 'Verify Your Email Address';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Verify Your Email Address</h2>
        <p>Thank you for signing up! Please verify your email address to complete your registration.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Verify Email
          </a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
        <p>This link will expire in 24 hours.</p>
        <p>If you didn't create an account, please ignore this email.</p>
      </div>
    `;

    await this.sendEmail({ to: email, subject, html });
  }

  /**
   * Send order confirmation email
   */
  async sendOrderConfirmation(email: string, orderDetails: any): Promise<void> {
    const subject = `Order Confirmation - #${orderDetails.orderNumber}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Order Confirmation</h2>
        <p>Thank you for your order! Here are the details:</p>
        <div style="background-color: #f5f5f5; padding: 20px; margin: 20px 0;">
          <p><strong>Order Number:</strong> ${orderDetails.orderNumber}</p>
          <p><strong>Total Amount:</strong> $${orderDetails.totalAmount}</p>
          <p><strong>Status:</strong> ${orderDetails.status}</p>
        </div>
        <p>We'll send you another email when your order ships.</p>
        <p>Thank you for choosing genie help!</p>
      </div>
    `;

    await this.sendEmail({ to: email, subject, html });
  }

  /**
   * Send notification email
   */
  async sendNotification(email: string, title: string, message: string): Promise<void> {
    const subject = title;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${title}</h2>
        <p>${message}</p>
        <p>Best regards,<br>The genie help Team</p>
      </div>
    `;

    await this.sendEmail({ to: email, subject, html });
  }
}
