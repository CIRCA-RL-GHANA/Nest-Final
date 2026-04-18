import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@common/entities/base.entity';

export enum RevenueType {
  SUBSCRIPTION = 'subscription',
  TRANSACTION_FEE = 'transaction_fee',
  TRADE_FEE = 'trade_fee',
}

/**
 * Immutable ledger of every Q Point fee collected by the platform.
 * All amounts are in Q Points (1 QP = $1).
 */
@Entity('revenue_records')
@Index(['type'])
@Index(['entityId'])
@Index(['userId'])
@Index(['createdAt'])
export class RevenueRecord extends BaseEntity {
  @ApiProperty({ enum: RevenueType, description: 'Type of revenue event' })
  @Column({ type: 'enum', enum: RevenueType })
  type: RevenueType;

  @ApiProperty({ description: 'Q Points collected', example: 0.02 })
  @Column({ type: 'decimal', precision: 12, scale: 4 })
  amountQPoints: number;

  @ApiProperty({ description: 'Business entity ID (subscriptions / tx fees)', required: false })
  @Column({ type: 'uuid', nullable: true })
  entityId: string | null;

  @ApiProperty({ description: 'User ID (trade fees)', required: false })
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ApiProperty({ description: 'Reference ID (trade id, order id, subscription id)', required: false })
  @Column({ type: 'varchar', length: 100, nullable: true })
  refId: string | null;

  @ApiProperty({ description: 'Extra contextual data', required: false })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
