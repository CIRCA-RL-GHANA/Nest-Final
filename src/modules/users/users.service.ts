import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { Otp } from './entities/otp.entity';
import { Staff, StaffRole } from './entities/staff.entity';
import { AuditLog } from './entities/audit-log.entity';
import { RegisterUserDto } from './dto/register-user.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { VerifyBiometricDto } from './dto/verify-biometric.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { AssignStaffRoleDto } from './dto/assign-staff-role.dto';
import { AIFraudService } from '../ai/services/ai-fraud.service';
import { AINlpService } from '../ai/services/ai-nlp.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Otp)
    private readonly otpRepository: Repository<Otp>,
    @InjectRepository(Staff)
    private readonly staffRepository: Repository<Staff>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly configService: ConfigService,
    private readonly aiFraud: AIFraudService,
    private readonly aiNlp: AINlpService,
  ) {}

  async register(registerUserDto: RegisterUserDto): Promise<{ userId: string; message: string }> {
    const { phoneNumber, socialUsername, wireId, password, ...metadata } = registerUserDto;

    // Check phone number uniqueness
    const existingPhone = await this.userRepository.findOne({ where: { phoneNumber } });
    if (existingPhone) {
      await this.logAudit('User Registration', 'FAILED', null, {
        reason: 'Phone number exists',
        phoneNumber,
      });
      throw new ConflictException('Phone number already registered. Try password recovery.');
    }

    // Check social username availability
    const existingUsername = await this.userRepository.findOne({ where: { socialUsername } });
    if (existingUsername) {
      await this.logAudit('User Registration', 'FAILED', null, {
        reason: 'Username taken',
        socialUsername,
      });
      throw new ConflictException('Social username already taken. Try another.');
    }

    // Check Wire ID uniqueness
    const existingWireId = await this.userRepository.findOne({ where: { wireId } });
    if (existingWireId) {
      await this.logAudit('User Registration', 'FAILED', null, {
        reason: 'Wire ID exists',
        wireId,
      });
      throw new ConflictException('Wire ID already in use.');
    }

    try {
      // Create user (password will be hashed automatically via BeforeInsert hook)
      const user = this.userRepository.create({
        phoneNumber,
        socialUsername,
        wireId,
        passwordHash: password,
        ...metadata,
      });

      const savedUser = await this.userRepository.save(user);

      // Generate and send OTP
      await this.generateAndSendOtp(phoneNumber);

      // Log successful registration
      await this.logAudit('User Registration', 'SUCCESS', savedUser.id, {
        phoneNumber,
        socialUsername,
        wireId,
        ...metadata,
      });

      this.logger.log(`User registered successfully: ${savedUser.id}`);

      return {
        userId: savedUser.id,
        message: 'User registered successfully. OTP sent to phone number.',
      };
    } catch (error) {
      this.logger.error(`Registration failed: ${error.message}`, error.stack);
      await this.logAudit('User Registration', 'ERROR', null, { error: error.message });
      throw new BadRequestException('Registration failed. Please try again.');
    }
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto): Promise<{ message: string }> {
    const { phoneNumber, code } = verifyOtpDto;

    // Find latest OTP for this phone number
    const otpRecord = await this.otpRepository.findOne({
      where: { phoneNumber },
      order: { createdAt: 'DESC' },
    });

    if (!otpRecord) {
      await this.logAudit('OTP Verification', 'FAILED', null, {
        reason: 'No OTP found',
        phoneNumber,
      });
      throw new NotFoundException('OTP not found. Please request a new one.');
    }

    if (otpRecord.verified) {
      await this.logAudit('OTP Verification', 'FAILED', null, {
        reason: 'OTP already used',
        phoneNumber,
      });
      throw new BadRequestException('OTP already used. Request a new one.');
    }

    if (otpRecord.expiresAt < new Date()) {
      await this.logAudit('OTP Verification', 'FAILED', null, {
        reason: 'OTP expired',
        phoneNumber,
      });
      throw new BadRequestException('OTP expired. Please request a new one.');
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await this.logAudit('OTP Verification', 'FAILED', null, {
        reason: 'Too many attempts',
        phoneNumber,
      });
      throw new BadRequestException('Too many failed attempts. Please request a new OTP.');
    }

    const storedBuf = Buffer.from(otpRecord.code);
    const inputBuf = Buffer.from(code);
    const codesMatch =
      storedBuf.length === inputBuf.length &&
      crypto.timingSafeEqual(storedBuf, inputBuf);
    if (!codesMatch) {
      await this.otpRepository.update(otpRecord.id, { attempts: otpRecord.attempts + 1 });
      await this.logAudit('OTP Verification', 'FAILED', null, {
        reason: 'Incorrect OTP',
        phoneNumber,
        attempt: otpRecord.attempts + 1,
      });
      throw new UnauthorizedException('Incorrect OTP. Please try again.');
    }

    // Mark OTP as verified
    await this.otpRepository.update(otpRecord.id, { verified: true });

    // Update user status
    const user = await this.userRepository.findOne({ where: { phoneNumber } });
    if (user) {
      await this.userRepository.update(user.id, { otpVerified: true });
      await this.logAudit('OTP Verification', 'SUCCESS', user.id, { phoneNumber });
      this.logger.log(`OTP verified for user: ${user.id}`);
    }

    return { message: 'OTP verified successfully.' };
  }

  async verifyBiometric(verifyBiometricDto: VerifyBiometricDto): Promise<{ message: string }> {
    const { userId, biometricStatus } = verifyBiometricDto;

    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user || !user.otpVerified) {
      await this.logAudit('Biometric Verification', 'FAILED', userId, {
        reason: 'User not found or OTP not verified',
      });
      throw new BadRequestException('User not eligible for biometric verification.');
    }

    // ISSUE-D: this endpoint is @Public — block downgrade attempts.
    // biometricVerified can only be set to true here; revocation must go through an
    // authenticated admin endpoint to prevent any caller from locking users out.
    if (!biometricStatus) {
      await this.logAudit('Biometric Verification', 'FAILED', userId, {
        reason: 'Attempt to revoke biometric via public endpoint',
      });
      throw new BadRequestException(
        'Biometric verification cannot be revoked via this endpoint.',
      );
    }

    await this.userRepository.update(userId, { biometricVerified: biometricStatus });

    await this.logAudit('Biometric Verification', 'SUCCESS', userId, { biometricStatus });

    this.logger.log(`Biometric verification updated for user: ${userId}`);

    return { message: 'Biometric verification status updated successfully.' };
  }

  async setPin(setPinDto: SetPinDto): Promise<{ message: string }> {
    const { userId, entityId, pin } = setPinDto;

    // ISSUE-E: public endpoint — verify the user exists and has completed OTP
    // before creating a privileged Staff/OWNER record.
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found.');
    }
    if (!user.otpVerified) {
      throw new BadRequestException('Phone number not verified. Complete OTP verification first.');
    }

    try {
      // PIN will be hashed automatically via BeforeInsert hook
      const staff = this.staffRepository.create({
        userId,
        entityId,
        role: StaffRole.OWNER,
        pinHash: pin,
      });

      await this.staffRepository.save(staff);

      await this.logAudit('PIN Setup', 'SUCCESS', userId, { entityId });

      this.logger.log(`PIN set for user: ${userId} on entity: ${entityId}`);

      return { message: 'PIN setup successful.' };
    } catch (error) {
      this.logger.error(`PIN setup failed: ${error.message}`, error.stack);
      await this.logAudit('PIN Setup', 'ERROR', userId, { error: error.message });
      throw new BadRequestException('PIN setup failed. Please try again.');
    }
  }

  async assignStaffRole(assignStaffRoleDto: AssignStaffRoleDto): Promise<{ message: string }> {
    const { adminId, userId, entityId, role, pin, isBranch, posId, branchId } = assignStaffRoleDto;

    // Validate admin privileges
    const adminRole = isBranch ? StaffRole.BRANCH_MANAGER : StaffRole.ADMINISTRATOR;
    const adminRecord = await this.staffRepository.findOne({
      where: { userId: adminId, entityId, role: adminRole, isActive: true },
    });

    if (!adminRecord) {
      await this.logAudit('Staff Assignment', 'FAILED', adminId, {
        reason: 'Unauthorized admin',
        requiredRole: adminRole,
      });
      throw new UnauthorizedException('Only authorized admins can assign roles.');
    }

    // Validate role based on entity type
    const validEntityRoles = [
      StaffRole.ADMINISTRATOR,
      StaffRole.SOCIAL_OFFICER,
      StaffRole.RESPONSE_OFFICER,
      StaffRole.MONITOR,
    ];
    const validBranchRoles = [
      StaffRole.BRANCH_MANAGER,
      StaffRole.SOCIAL_OFFICER,
      StaffRole.RESPONSE_OFFICER,
      StaffRole.MONITOR,
      StaffRole.DRIVER,
    ];

    const validRoles = isBranch ? validBranchRoles : validEntityRoles;
    if (!validRoles.includes(role)) {
      await this.logAudit('Staff Assignment', 'FAILED', adminId, {
        reason: 'Invalid role',
        role,
        isBranch,
      });
      throw new BadRequestException(
        `Invalid role for ${isBranch ? 'branch' : 'entity'} assignment.`,
      );
    }

    try {
      // Create staff record (PIN will be hashed automatically)
      const staff = this.staffRepository.create({
        userId,
        entityId,
        role,
        pinHash: pin,
        posId: role === StaffRole.RESPONSE_OFFICER ? posId : null,
        branchId,
        isActive: true,
      });

      await this.staffRepository.save(staff);

      await this.logAudit('Staff Assignment', 'SUCCESS', adminId, {
        assignedUserId: userId,
        entityId,
        role,
        isBranch,
        branchId,
      });

      this.logger.log(`Staff role assigned: ${role} to user ${userId} by admin ${adminId}`);

      return { message: 'Staff role assigned successfully.' };
    } catch (error) {
      this.logger.error(`Staff assignment failed: ${error.message}`, error.stack);
      await this.logAudit('Staff Assignment', 'ERROR', adminId, { error: error.message });
      throw new BadRequestException('Staff assignment failed. Please try again.');
    }
  }

  private async generateAndSendOtp(phoneNumber: string): Promise<void> {
    // ISSUE-11: use CSPRNG — Math.random() is not cryptographically secure
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiryMinutes = this.configService.get<number>('security.otpExpiryMinutes') || 5;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Save OTP to database
    const otp = this.otpRepository.create({
      phoneNumber,
      code,
      expiresAt,
      type: 'sms',
    });

    await this.otpRepository.save(otp);

    // Send OTP via SMS service
    try {
      await this.sendOtpSms(phoneNumber, code);
      this.logger.log(`OTP sent to ${phoneNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP SMS to ${phoneNumber}: ${error.message}`);
    }
  }

  private async sendOtpSms(phoneNumber: string, otp: string): Promise<void> {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const fromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER');

    if (!accountSid?.startsWith('AC') || !authToken || !fromNumber?.startsWith('+')) {
      this.logger.warn(`Twilio credentials not configured – OTP not delivered to ${phoneNumber}`);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Twilio = require('twilio');
    const client = new Twilio(accountSid, authToken);

    await client.messages.create({
      body: `Your genie help verification code is: ${otp}. Valid for 10 minutes. Never share this code with anyone.`,
      from: fromNumber,
      to: phoneNumber,
    });
  }

  /**
   * AI: Analyse a user's bio for keywords and sentiment.
   */
  async getAIUserInsights(
    userId: string,
  ): Promise<{ keywords: string[]; sentiment: string; summary: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const bio = (user as any).bio ?? (user as any).socialUsername ?? '';
    if (!bio) return { keywords: [], sentiment: 'neutral', summary: '' };
    try {
      const [kwResult, sentResult, sumResult] = await Promise.all([
        this.aiNlp.extractKeywords(bio),
        this.aiNlp.analyzeSentiment(bio),
        this.aiNlp.summariseText(bio),
      ]);
      return { keywords: kwResult, sentiment: sentResult.label, summary: sumResult.summary };
    } catch {
      return { keywords: [], sentiment: 'neutral', summary: '' };
    }
  }

  /**
   * AI: Score a login event for anomalous behaviour.
   * Returns riskScore 0-100 and flags array.
   */
  async scoreLoginRisk(
    userId: string,
    ipAddress: string,
  ): Promise<{ riskScore: number; flags: string[] }> {
    try {
      // ISSUE-38: use async scorer (includes TF model); ISSUE-40: include ipAddress
      const result = await this.aiFraud.scoreTransactionAsync({
        userId,
        amount: 0,
        currency: 'NGN',
        paymentMethod: 'login',
        metadata: { ipAddress },
      });
      return {
        riskScore: Math.round(result.riskScore * 100),
        flags: result.reviewFlag ? ['AI review flag'] : [],
      };
    } catch {
      return { riskScore: 0, flags: [] };
    }
  }

  private async logAudit(
    action: string,
    status: string,
    userId: string | null,
    metadata: Record<string, any>,
  ): Promise<void> {
    try {
      const auditLog = this.auditLogRepository.create({
        action,
        status,
        userId,
        metadata,
        ipAddress: metadata.ipAddress || null,
        userAgent: metadata.userAgent || null,
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(`Audit logging failed: ${error.message}`, error.stack);
    }
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByPhoneNumber(phoneNumber: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { phoneNumber } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async checkUsernameAvailability(
    username: string,
  ): Promise<{ available: boolean; username: string }> {
    const existing = await this.userRepository.findOne({
      where: { socialUsername: username },
    });
    return { available: !existing, username };
  }

  async checkPhoneExists(phoneNumber: string): Promise<{ exists: boolean; phoneNumber: string }> {
    const existing = await this.userRepository.findOne({
      where: { phoneNumber },
    });
    return { exists: !!existing, phoneNumber };
  }

  async resendOtp(phoneNumber: string): Promise<{ message: string }> {
    // ISSUE-16: never auto-create shadow users — callers must register first
    const user = await this.userRepository.findOne({ where: { phoneNumber } });
    if (!user) {
      throw new NotFoundException('Phone number not registered. Please register first.');
    }

    await this.generateAndSendOtp(phoneNumber);
    await this.logAudit('OTP Resend', 'SUCCESS', user.id, { phoneNumber });

    return { message: 'OTP sent to phone number.' };
  }
}
