import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@common/entities/base.entity';

export enum SubscriptionTier {
  FREE = 'Free',
  BASIC = 'Basic',
  PROFESSIONAL = 'Professional',
  ENTERPRISE = 'Enterprise',
}

/**
 * Revenue model:
 *  – Free:         0 QP/staff/month. Core tools only.
 *  – Basic:        4 QP/staff/month. Core business management tools.
 *  – Professional: 8 QP/staff/month. Basic + native social features
 *                  (branded updates, customer engagement).
 *  – Enterprise:  12 QP/staff/month. Professional + marketing tools
 *                  (targeted promotions, analytics).
 *
 * First month is a free trial for all new businesses:
 *  – Subscription fee waived.
 *  – All features unlocked (Enterprise-level).
 *  – Transaction fee quota = 0 (every transaction incurs $0.02 immediately).
 */
@Entity('subscription_plans')
@Index(['name'], { unique: true })
export class SubscriptionPlan extends BaseEntity {
  @ApiProperty({ description: 'Plan name', enum: SubscriptionTier, example: SubscriptionTier.BASIC })
  @Column({ type: 'varchar', length: 50, unique: true })
  name: string;

  @ApiProperty({
    description: 'Plan description',
    required: false,
    example: 'Core business management tools',
  })
  @Column({ type: 'text', nullable: true })
  description: string;

  @ApiProperty({ description: 'Booster points allocation per billing cycle', example: '100.00' })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  boosterPointsAllocation: number;

  /**
   * @deprecated Use pricePerStaffQPoints for per-staff billing.
   * Retained for plans that use a flat fee (e.g. legacy Free plan).
   */
  @ApiProperty({ description: 'Flat monthly cost in Q-Points (legacy / free tier)', example: '0.00' })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  monthlyCostQPoints: number;

  @ApiProperty({
    description: 'Cost per active staff member per month in Q-Points ($4 = 4 QP at $1/QP)',
    example: '4.00',
  })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  pricePerStaffQPoints: number;

  @ApiProperty({ description: 'Includes native social features (branded updates, engagement)', example: false })
  @Column({ type: 'boolean', default: false })
  includesSocialFeatures: boolean;

  @ApiProperty({ description: 'Includes marketing tools (promotions, analytics)', example: false })
  @Column({ type: 'boolean', default: false })
  includesMarketingTools: boolean;

  @ApiProperty({ description: 'Maximum branches allowed', example: 5 })
  @Column({ type: 'int', nullable: true })
  maxBranches: number;

  @ApiProperty({ description: 'Maximum staff members allowed', example: 10 })
  @Column({ type: 'int', nullable: true })
  maxStaff: number;

  @ApiProperty({ description: 'Whether plan is active', example: true })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({ description: 'Features included in plan', type: [String], required: false })
  @Column({ type: 'jsonb', nullable: true })
  features: string[];
}
