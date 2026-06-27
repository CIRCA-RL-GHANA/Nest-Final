import { Injectable, UnauthorizedException, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { Otp } from '../users/entities/otp.entity';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { TokenBlacklistService } from './token-blacklist.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  tokenType: string;
}

export interface LoginResponse {
  user: {
    id: string;
    phoneNumber: string;
    socialUsername: string | null;
    wireId: string | null;
    biometricVerified: boolean;
    otpVerified: boolean;
  };
  tokens: AuthTokens;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Otp)
    private readonly otpRepository: Repository<Otp>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly blacklist: TokenBlacklistService,
  ) {}

  async login(loginDto: LoginDto): Promise<LoginResponse> {
    const { identifier, password } = loginDto;
    const normalizedPhone = identifier.replace(/[\s\-\(\)]/g, '').replace(/^(\+\d{1,3})0(\d+)$/, '$1$2');

    // Find user by phone number OR social username
    const user = await this.userRepository.findOne({
      where: [{ phoneNumber: normalizedPhone }, { socialUsername: identifier }],
      select: [
        'id',
        'phoneNumber',
        'socialUsername',
        'wireId',
        'passwordHash',
        'biometricVerified',
        'otpVerified',
      ],
    });

    if (!user) {
      this.logger.warn(`Login failed: user not found for identifier=${identifier}`);
      throw new UnauthorizedException('Invalid credentials. Check your phone number or password.');
    }

    // Verify password
    const isPasswordValid = await user.validatePassword(password);
    if (!isPasswordValid) {
      this.logger.warn(`Login failed: wrong password for user=${user.id}`);
      throw new UnauthorizedException('Invalid credentials. Check your phone number or password.');
    }

    // Check OTP verification
    if (!user.otpVerified) {
      throw new BadRequestException(
        'Phone number not verified. Please complete OTP verification first.',
      );
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    this.logger.log(`User logged in: ${user.id}`);

    return {
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        socialUsername: user.socialUsername,
        wireId: user.wireId,
        biometricVerified: user.biometricVerified,
        otpVerified: user.otpVerified,
      },
      tokens,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;

    try {
      const refreshSecret = this.configService.get<string>('jwt.refreshSecret');
      if (!refreshSecret) {
        throw new Error('JWT_REFRESH_SECRET environment variable is required');
      }
      payload = this.jwtService.verify<JwtPayload>(refreshToken, { secret: refreshSecret });
    } catch (error) {
      this.logger.warn(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new UnauthorizedException('Invalid or expired refresh token. Please login again.');
    }

    // Reject already-used refresh tokens (prevents refresh token reuse attacks)
    if (payload.jti && (await this.blacklist.isBlacklisted(payload.jti))) {
      this.logger.warn(`Refresh token reuse detected: jti=${payload.jti} user=${payload.sub}`);
      throw new UnauthorizedException('Refresh token has already been used. Please login again.');
    }

    const user = await this.userRepository.findOne({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Rotate: blacklist the consumed refresh token before issuing a new pair
    if (payload.jti) {
      const now = Math.floor(Date.now() / 1000);
      const ttl = (payload.exp ?? now + 1) - now;
      if (ttl > 0) {
        await this.blacklist.blacklist(payload.jti, ttl);
      }
    }

    return this.generateTokens(user);
  }

  async logout(bearerToken: string): Promise<void> {
    try {
      const secret = this.configService.get<string>('jwt.secret');
      const payload = this.jwtService.verify<JwtPayload>(bearerToken, { secret });
      if (payload.jti) {
        const now = Math.floor(Date.now() / 1000);
        const ttl = (payload.exp ?? now + 1) - now;
        await this.blacklist.blacklist(payload.jti, ttl);
      }
    } catch {
      // Token already expired or malformed — no action needed
    }
  }

  async forgotPassword(phoneNumber: string): Promise<{ message: string }> {
    const normalized = phoneNumber.replace(/[\s\-\(\)]/g, '').replace(/^(\+\d{1,3})0(\d+)$/, '$1$2');
    const user = await this.userRepository.findOne({ where: { phoneNumber: normalized } });
    if (!user) {
      throw new NotFoundException('No account found for this phone number.');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiryMinutes = this.configService.get<number>('security.otpExpiryMinutes') || 5;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const otp = this.otpRepository.create({ phoneNumber: normalized, code, expiresAt, type: 'password_reset' });
    await this.otpRepository.save(otp);

    try {
      await this.sendPasswordResetSms(normalized, code, expiryMinutes);
      this.logger.log(`Password reset OTP sent to ${normalized}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset SMS: ${error instanceof Error ? error.message : String(error)}`);
      this.logger.log(`Password reset OTP for ${normalized}: ${code}`);
    }

    return { message: 'Password reset code sent to your phone number.' };
  }

  async resetPassword(phoneNumber: string, code: string, newPassword: string): Promise<{ message: string }> {
    const normalized = phoneNumber.replace(/[\s\-\(\)]/g, '').replace(/^(\+\d{1,3})0(\d+)$/, '$1$2');

    const otpRecord = await this.otpRepository.findOne({
      where: { phoneNumber: normalized, type: 'password_reset' },
      order: { createdAt: 'DESC' },
    });

    if (!otpRecord) throw new BadRequestException('No password reset code found. Please request a new one.');
    if (otpRecord.verified) throw new BadRequestException('Reset code already used. Please request a new one.');
    if (otpRecord.expiresAt < new Date()) throw new BadRequestException('Reset code expired. Please request a new one.');
    if (otpRecord.attempts >= otpRecord.maxAttempts) throw new BadRequestException('Too many failed attempts. Please request a new code.');
    if (otpRecord.code !== code) {
      await this.otpRepository.update(otpRecord.id, { attempts: otpRecord.attempts + 1 });
      throw new BadRequestException('Incorrect reset code. Please try again.');
    }

    const user = await this.userRepository.findOne({ where: { phoneNumber: normalized }, select: ['id', 'phoneNumber', 'passwordHash'] });
    if (!user) throw new NotFoundException('Account not found.');

    await this.otpRepository.update(otpRecord.id, { verified: true });
    await this.userRepository.update(user.id, { passwordHash: await bcrypt.hash(newPassword, 12) });

    this.logger.log(`Password reset successful for user ${user.id}`);
    return { message: 'Password reset successfully. You can now log in with your new password.' };
  }

  private async sendPasswordResetSms(phoneNumber: string, code: string, expiryMinutes: number): Promise<void> {
    const accountSid = this.configService.get<string>('sms.twilioAccountSid');
    const authToken = this.configService.get<string>('sms.twilioAuthToken');
    const fromNumber = this.configService.get<string>('sms.twilioPhoneNumber');
    if (!accountSid?.startsWith('AC') || !authToken || !fromNumber?.startsWith('+')) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Twilio = require('twilio');
    const client = new Twilio(accountSid, authToken);
    await client.messages.create({
      body: `Your Genie password reset code is: ${code}. Valid for ${expiryMinutes} minutes. If you did not request this, ignore this message.`,
      from: fromNumber,
      to: phoneNumber,
    });
  }

  async validateUser(userId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id: userId } });
  }

  private async generateTokens(user: User): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      jti: uuidv4(),
      phoneNumber: user.phoneNumber,
      socialUsername: user.socialUsername,
      wireId: user.wireId,
    };

    const expiresIn = this.configService.get<string>('jwt.expiresIn') || '7d';

    const jwtSecret = this.configService.get<string>('jwt.secret');
    const refreshSecret = this.configService.get<string>('jwt.refreshSecret');
    if (!jwtSecret || !refreshSecret) {
      throw new Error('JWT_SECRET and JWT_REFRESH_SECRET environment variables are required');
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: jwtSecret,
        expiresIn,
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: this.configService.get<string>('jwt.refreshExpiresIn') || '30d',
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
    };
  }
}
