import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum ReferralStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
}

@Entity('ride_referrals')
@Index(['referrerId'])
@Index(['refereeId'])
@Index(['status'])
export class RideReferral extends BaseEntity {
  @ApiProperty({ description: 'Referrer user ID' })
  @Column({ type: 'uuid' })
  referrerId: string;

  @ApiProperty({ description: 'Referee user ID' })
  @Column({ type: 'uuid' })
  refereeId: string;

  @ApiProperty({ description: 'Referral code', example: 'REF123ABC' })
  @Column({ type: 'varchar', unique: true, length: 20 })
  referralCode: string;

  @ApiProperty({ description: 'Referral status', enum: ReferralStatus })
  @Column({ type: 'enum', enum: ReferralStatus, default: ReferralStatus.PENDING })
  status: ReferralStatus;

  @ApiProperty({ description: 'Reward QPoints for referrer' })
  @Column({ type: 'int', default: 0 })
  referrerReward: number;

  @ApiProperty({ description: 'Reward QPoints for referee' })
  @Column({ type: 'int', default: 0 })
  refereeReward: number;

  @ApiProperty({ description: 'Whether referrer was rewarded' })
  @Column({ type: 'boolean', default: false })
  referrerRewarded: boolean;

  @ApiProperty({ description: 'Whether referee was rewarded' })
  @Column({ type: 'boolean', default: false })
  refereeRewarded: boolean;

  @ApiProperty({ description: 'Ride that triggered completion', required: false })
  @Column({ type: 'uuid', nullable: true })
  completionRideId: string | null;

  @ApiProperty({ description: 'When referral was completed', required: false })
  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @ApiProperty({ description: 'Referral expiry date', required: false })
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;
}
