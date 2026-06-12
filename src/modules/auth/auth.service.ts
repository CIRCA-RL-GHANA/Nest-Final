import {
  Injectable,
  UnauthorizedException,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../users/entities/user.entity';
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
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly blacklist: TokenBlacklistService,
  ) {}

  async login(loginDto: LoginDto): Promise<LoginResponse> {
    const { identifier, password } = loginDto;

    // ISSUE-19: check login lockout before any DB lookup
    if (await this.blacklist.isLoginLocked(identifier)) {
      throw new HttpException(
        'Too many failed login attempts. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Find user by phone number OR social username
    const user = await this.userRepository.findOne({
      where: [{ phoneNumber: identifier }, { socialUsername: identifier }],
      select: [
        'id',
        'phoneNumber',
        'socialUsername',
        'wireId',
        'passwordHash',
        'biometricVerified',
        'otpVerified',
        'role',
        'isActive',
      ],
    });

    if (!user) {
      await this.blacklist.recordLoginFailure(identifier);
      this.logger.warn(`Login failed: user not found for identifier=***`);
      throw new UnauthorizedException('Invalid credentials. Check your phone number or password.');
    }

    // Verify password
    const isPasswordValid = await user.validatePassword(password);
    if (!isPasswordValid) {
      await this.blacklist.recordLoginFailure(identifier);
      this.logger.warn(`Login failed: wrong password for user=${user.id}`);
      throw new UnauthorizedException('Invalid credentials. Check your phone number or password.');
    }

    // Check account active status
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated. Please contact support.');
    }

    // Check OTP verification
    if (!user.otpVerified) {
      throw new BadRequestException(
        'Phone number not verified. Please complete OTP verification first.',
      );
    }

    // Clear any previous failure count on successful login
    await this.blacklist.clearLoginFailures(identifier);

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
    try {
      const refreshSecret = this.configService.get<string>('jwt.refreshSecret');
      if (!refreshSecret) {
        throw new Error('JWT_REFRESH_SECRET environment variable is required');
      }

      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: refreshSecret,
      });

      // ISSUE-08: reject blacklisted refresh tokens
      if (payload.jti && (await this.blacklist.isRefreshTokenBlacklisted(payload.jti))) {
        throw new UnauthorizedException('Refresh token has been revoked. Please login again.');
      }

      const user = await this.userRepository.findOne({
        where: { id: payload.sub, isActive: true },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const newTokens = await this.generateTokens(user);

      // ISSUE-S: rotate — blacklist the consumed refresh token so it cannot be reused
      if (payload.jti) {
        const now = Math.floor(Date.now() / 1000);
        const remainingTtl = (payload.exp ?? now + 1) - now;
        if (remainingTtl > 0) {
          await this.blacklist.blacklistRefreshToken(payload.jti, remainingTtl);
        }
      }

      return newTokens;
    } catch (error) {
      this.logger.warn(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new UnauthorizedException('Invalid or expired refresh token. Please login again.');
    }
  }

  // ISSUE-08: accepts optional refreshToken to blacklist it alongside the access token
  async logout(bearerToken: string, refreshToken?: string): Promise<void> {
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

    if (refreshToken) {
      try {
        const refreshSecret = this.configService.get<string>('jwt.refreshSecret');
        const rPayload = this.jwtService.verify<JwtPayload>(refreshToken, { secret: refreshSecret });
        if (rPayload.jti) {
          const now = Math.floor(Date.now() / 1000);
          const ttl = (rPayload.exp ?? now + 1) - now;
          await this.blacklist.blacklistRefreshToken(rPayload.jti, ttl);
        }
      } catch {
        // Refresh token already expired or malformed — no action needed
      }
    }
  }

  async validateUser(userId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id: userId, isActive: true } });
  }

  private async generateTokens(user: User): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      jti: uuidv4(),
      phoneNumber: user.phoneNumber,
      socialUsername: user.socialUsername,
      wireId: user.wireId,
      role: user.role,
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
