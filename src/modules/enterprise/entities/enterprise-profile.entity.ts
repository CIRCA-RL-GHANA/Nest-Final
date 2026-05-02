import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum EnterpriseType {
  CORPORATION = 'corporation',
  STREAMING_PLATFORM = 'streaming_platform',
  RECORD_LABEL = 'record_label',
  DELIVERY_NETWORK = 'delivery_network',
  FOOD_AGGREGATOR = 'food_aggregator',
  MARKETPLACE = 'marketplace',
  QSR_CHAIN = 'qsr_chain',
  FINANCIAL_INSTITUTION = 'financial_institution',
  OTHER = 'other',
}

export enum EnterpriseStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  TERMINATED = 'terminated',
}

@Entity('enterprise_profiles')
export class EnterpriseProfile extends BaseEntity {
  @ApiProperty({ description: 'Entity ID of the enterprise' })
  @Column({ type: 'uuid', unique: true })
  @Index()
  entityId: string;

  @ApiProperty({ enum: EnterpriseType })
  @Column({ type: 'enum', enum: EnterpriseType, default: EnterpriseType.CORPORATION })
  enterpriseType: EnterpriseType;

  @ApiProperty({ enum: EnterpriseStatus })
  @Column({ type: 'enum', enum: EnterpriseStatus, default: EnterpriseStatus.PENDING })
  @Index()
  status: EnterpriseStatus;

  @ApiProperty({ required: false, description: 'Official business/trade name' })
  @Column({ type: 'varchar', length: 300, nullable: true })
  legalName: string | null;

  @ApiProperty({ required: false, description: 'Tax / company registration number' })
  @Column({ type: 'varchar', length: 100, nullable: true })
  taxId: string | null;

  @ApiProperty({ required: false })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  licenceDocumentUrl: string | null;

  @ApiProperty({ description: 'Set to true by platform admin after KYB verification' })
  @Column({ type: 'boolean', default: false })
  @Index()
  verified: boolean;

  @ApiProperty({ required: false, description: 'Integration pathways enabled (1-5)' })
  @Column({ type: 'jsonb', nullable: true })
  enabledPathways: number[] | null;

  @ApiProperty({ required: false, description: 'Arbitrary settings blob (addresses, FX prefs, risk thresholds, etc.)' })
  @Column({ type: 'jsonb', nullable: true })
  settings: Record<string, any> | null;

  @ApiProperty({ required: false, description: 'Webhook URL for order/inventory events' })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  webhookUrl: string | null;

  @ApiProperty({ description: 'Monthly subscription fee per staff seat ($4)' })
  @Column({ type: 'numeric', precision: 10, scale: 4, default: 4 })
  staffSeatFeeUsd: number;

  @ApiProperty({ description: 'Per-transaction fee in QP ($0.02 equivalent)' })
  @Column({ type: 'numeric', precision: 18, scale: 4, default: 0.02 })
  perTxFeeQp: number;

  @ApiProperty({ required: false, description: 'Parent enterprise entity ID (for branches)' })
  @Column({ type: 'uuid', nullable: true })
  @Index()
  parentEnterpriseId: string | null;

  @ApiProperty({ description: 'Whether this is a facilitator-grade institutional member' })
  @Column({ type: 'boolean', default: false })
  isFacilitator: boolean;

  @ApiProperty({ required: false, description: 'Max Q-Points issuance cap (for facilitators)' })
  @Column({ type: 'numeric', precision: 22, scale: 4, nullable: true })
  qpIssuanceCap: number | null;
}
