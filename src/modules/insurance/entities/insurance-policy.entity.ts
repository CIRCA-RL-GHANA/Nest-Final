import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum InsurancePolicyType {
  HEALTH = 'health',
  MOTOR = 'motor',
  INVENTORY = 'inventory',
  LIFE = 'life',
  PROPERTY = 'property',
  TRAVEL = 'travel',
  OTHER = 'other',
}

export enum InsurancePolicyStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  CLAIMED = 'claimed',
}

@Entity('insurance_policies')
export class InsurancePolicy extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  fiEntityId: string;

  @ApiProperty({ enum: InsurancePolicyType })
  @Column({ type: 'enum', enum: InsurancePolicyType })
  policyType: InsurancePolicyType;

  @ApiProperty({ enum: InsurancePolicyStatus })
  @Column({ type: 'enum', enum: InsurancePolicyStatus, default: InsurancePolicyStatus.ACTIVE })
  @Index()
  status: InsurancePolicyStatus;

  @ApiProperty({ description: 'Premium paid in Q-Points' })
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  premiumQp: number;

  @ApiProperty({ description: 'Maximum coverage in Q-Points' })
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  coverageQp: number;

  @ApiProperty({ description: '5% platform commission deducted from premium at purchase' })
  @Column({ type: 'numeric', precision: 18, scale: 4, default: 0 })
  platformFeeQp: number;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  startDate: Date;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  endDate: Date;

  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  premiumTxId: string | null;

  @ApiProperty({ required: false })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
