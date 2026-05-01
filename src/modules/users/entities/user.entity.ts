import { Entity, Column, Index, BeforeInsert } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import { BaseEntity } from '@/common/entities/base.entity';

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  // ── Financial Institution roles ──────────────────────────────────────────
  /** Top-level FI entity owner: full access to loans, deposits, insurance, credit-data. */
  FINANCIAL_INSTITUTION = 'financial_institution',
  /** FI staff: can read & create/approve loans. */
  FI_LOAN_OFFICER = 'fi_loan_officer',
  /** FI staff: teller / deposit & insurance processing. */
  FI_TELLER = 'fi_teller',
  /** FI staff: read-only auditor. */
  FI_AUDITOR = 'fi_auditor',
}

@Entity('users')
export class User extends BaseEntity {
  @ApiProperty({
    description: 'User phone number (unique identifier)',
    example: '+1234567890',
  })
  @Column({ unique: true })
  @Index()
  phoneNumber: string;

  @ApiProperty({
    description: 'Social username for the user',
    example: 'john_doe',
    required: false,
  })
  @Column({ unique: true, nullable: true })
  @Index()
  socialUsername: string | null;

  @ApiProperty({
    description: 'Wire ID for the user',
    example: '@johndoe',
    required: false,
  })
  @Column({ unique: true, nullable: true })
  @Index()
  wireId: string | null;

  @Column({ select: false, nullable: true })
  passwordHash: string | null;

  @ApiProperty({
    description: 'Whether biometric verification is enabled',
    example: false,
  })
  @Column({ default: false })
  biometricVerified: boolean;

  @ApiProperty({
    description: 'Whether OTP verification is completed',
    example: false,
  })
  @Column({ default: false })
  otpVerified: boolean;

  @ApiProperty({
    description: 'Device fingerprint for security',
    example: 'device-fingerprint-hash',
    required: false,
  })
  @Column({ type: 'varchar', nullable: true })
  deviceFingerprint: string | null;

  @ApiProperty({
    description: 'IP address used during registration',
    example: '192.168.1.1',
    required: false,
  })
  @Column({ type: 'varchar', nullable: true })
  ipAddress: string | null;

  @ApiProperty({
    description: 'Geolocation data during registration',
    type: 'object',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  geolocation: Record<string, any> | null;

  @ApiProperty({
    description: 'User registration timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  registrationTimestamp: Date;

  @BeforeInsert()
  async hashPassword() {
    if (this.passwordHash) {
      this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
    }
  }

  async validatePassword(password: string): Promise<boolean> {
    if (!this.passwordHash) return false;
    return bcrypt.compare(password, this.passwordHash);
  }
}
