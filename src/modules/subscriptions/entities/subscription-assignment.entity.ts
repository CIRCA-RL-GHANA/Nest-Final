import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@common/entities/base.entity';
import { SubscriptionPlan } from './subscription-plan.entity';

export enum SubscriptionTargetType {
  ENTITY = 'Entity',
  BRANCH = 'Branch',
}

@Entity('subscription_assignments')
@Index(['targetType', 'targetId'])
export class SubscriptionAssignment extends BaseEntity {
  @ApiProperty({
    description: 'Target type (Entity or Branch)',
    enum: SubscriptionTargetType,
    example: SubscriptionTargetType.ENTITY,
  })
  @Column({ type: 'enum', enum: SubscriptionTargetType })
  targetType: SubscriptionTargetType;

  @ApiProperty({ description: 'Target ID (Entity or Branch ID)', example: 'uuid' })
  @Column({ type: 'uuid' })
  targetId: string;

  @ApiProperty({ description: 'Subscription plan ID', example: 'uuid' })
  @Column({ type: 'uuid' })
  planId: string;

  @ApiProperty({ description: 'Whether subscription is activated', example: true })
  @Column({ type: 'boolean', default: false })
  activated: boolean;

  @ApiProperty({ description: 'When subscription was activated', required: false })
  @Column({ type: 'timestamp', nullable: true })
  activatedAt: Date;

  @ApiProperty({ description: 'When subscription expires', required: false })
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date;

  @ApiProperty({ description: 'Whether subscription auto-renews', example: true })
  @Column({ type: 'boolean', default: true })
  autoRenew: boolean;

  @ApiProperty({ description: 'Last renewal date', required: false })
  @Column({ type: 'timestamp', nullable: true })
  lastRenewalAt: Date;

  @ApiProperty({
    description:
      'Number of active staff at the time of billing. Used to calculate per-staff subscription cost.',
    example: 5,
  })
  @Column({ type: 'int', default: 1 })
  staffCount: number;

  @ApiProperty({
    description:
      'Whether this assignment is in its first-month free trial. ' +
      'During a free trial the subscription fee is waived and all plan features are unlocked, ' +
      'but the transaction fee free-quota is 0 (every transaction costs $0.02 immediately).',
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  isInFreeTrial: boolean;

  @ApiProperty({ description: 'Timestamp when the free trial period ends', required: false })
  @Column({ type: 'timestamp', nullable: true })
  freeTrialEndsAt: Date | null;

  // Relations
  @ManyToOne(() => SubscriptionPlan, { eager: false, nullable: false })
  @JoinColumn({ name: 'planId' })
  plan: SubscriptionPlan;
}
