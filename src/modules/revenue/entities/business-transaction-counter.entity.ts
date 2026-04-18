import { Entity, Column, Index, Unique } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@common/entities/base.entity';

/**
 * Tracks the number of business transactions per entity per calendar month.
 * Used to enforce the free-transaction quota (100/month for paid plans, 0 in free trial).
 */
@Entity('business_transaction_counters')
@Unique(['entityId', 'calendarMonth'])
@Index(['entityId'])
export class BusinessTransactionCounter extends BaseEntity {
  @ApiProperty({ description: 'Business entity ID', example: 'uuid' })
  @Column({ type: 'uuid' })
  entityId: string;

  @ApiProperty({ description: 'Calendar month in YYYY-MM format', example: '2026-04' })
  @Column({ type: 'varchar', length: 7 })
  calendarMonth: string;

  @ApiProperty({ description: 'Total transactions recorded this month', example: 150 })
  @Column({ type: 'int', default: 0 })
  transactionCount: number;

  @ApiProperty({ description: 'Total fees collected in Q Points this month', example: 1.00 })
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  totalFeesQPoints: number;

  @ApiProperty({
    description: 'Free-transaction quota applied to this month (0 during free trial; 100 otherwise)',
    example: 100,
  })
  @Column({ type: 'int', default: 100 })
  freeQuota: number;
}
