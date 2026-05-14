import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

@Entity('otps')
export class Otp extends BaseEntity {
  @ApiProperty({
    description: 'Phone number associated with the OTP',
    example: '+1234567890',
  })
  @Column()
  @Index()
  phoneNumber: string;

  @ApiProperty({
    description: 'OTP code (6 digits)',
    example: '123456',
  })
  @Column()
  code: string;

  @ApiProperty({
    description: 'Expiration timestamp for the OTP',
    example: '2024-01-01T00:05:00.000Z',
  })
  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @ApiProperty({
    description: 'Whether the OTP has been verified',
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @ApiProperty({
    description: 'Number of verification attempts',
    example: 0,
  })
  @Column({ type: 'int', default: 0 })
  attempts: number;

  @ApiProperty({
    description: 'Maximum allowed attempts',
    example: 5,
  })
  @Column({ type: 'int', default: 5 })
  maxAttempts: number;

  @ApiProperty({
    description: 'Type of OTP (sms, email)',
    example: 'sms',
  })
  @Column({ type: 'varchar', default: 'sms' })
  type: string;
}
