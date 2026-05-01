import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

@Entity('fi_profiles')
export class FiProfile extends BaseEntity {
  @ApiProperty({ description: 'Entity ID of the financial institution' })
  @Column({ type: 'uuid', unique: true })
  @Index()
  entityId: string;

  @ApiProperty({ required: false })
  @Column({ type: 'varchar', length: 200, nullable: true })
  licenseNumber: string | null;

  @ApiProperty({ required: false })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  licenseDocumentUrl: string | null;

  @ApiProperty({ description: 'Set by platform admin after verifying license' })
  @Column({ type: 'boolean', default: false })
  @Index()
  licenseVerified: boolean;

  @ApiProperty({ required: false, description: 'FI-specific risk model configuration' })
  @Column({ type: 'jsonb', nullable: true })
  riskModelConfig: Record<string, any> | null;

  @ApiProperty({ required: false })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  webhookUrl: string | null;

  @ApiProperty({ description: 'Maximum loan amount this FI will offer in QP' })
  @Column({ type: 'numeric', precision: 18, scale: 4, default: 100000 })
  maxLoanAmountQp: number;

  @ApiProperty({ description: 'Minimum loan amount in QP' })
  @Column({ type: 'numeric', precision: 18, scale: 4, default: 100 })
  minLoanAmountQp: number;

  @ApiProperty({ description: 'Base annual interest rate (e.g. 0.15 = 15%)' })
  @Column({ type: 'numeric', precision: 6, scale: 4, default: 0.15 })
  baseInterestRate: number;

  @ApiProperty({ description: 'Per-query credit data fee in QP' })
  @Column({ type: 'numeric', precision: 18, scale: 4, default: 5 })
  creditQueryFeeQp: number;

  @ApiProperty({ required: false, description: 'Credit data subscription tier (basic | professional | enterprise)' })
  @Column({ type: 'varchar', length: 50, nullable: true })
  creditSubTier: string | null;
}
