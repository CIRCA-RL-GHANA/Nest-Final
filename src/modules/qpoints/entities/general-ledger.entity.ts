import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum LedgerAccountType {
  ASSET = 'Asset',
  LIABILITY = 'Liability',
  EQUITY = 'Equity',
  REVENUE = 'Revenue',
  EXPENSE = 'Expense',
}

@Entity('general_ledgers')
@Index(['accountCode'])
@Index(['accountType'])
export class GeneralLedger extends BaseEntity {
  @ApiProperty({
    description: 'Account code',
    example: '1000',
  })
  @Column({ type: 'varchar', unique: true })
  accountCode: string;

  @ApiProperty({
    description: 'Account name',
    example: 'Q-Points Assets',
  })
  @Column()
  accountName: string;

  @ApiProperty({
    description: 'Account type',
    enum: LedgerAccountType,
    example: LedgerAccountType.ASSET,
  })
  @Column({ type: 'enum', enum: LedgerAccountType })
  accountType: LedgerAccountType;

  @ApiProperty({
    description: 'Current balance',
    example: 10000.0,
  })
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  balance: number;

  @ApiProperty({
    description: 'Account description',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({
    description: 'Whether account is active',
    example: true,
  })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Parent account code',
    required: false,
  })
  @Column({ type: 'varchar', nullable: true })
  parentAccountCode: string | null;

  @ApiProperty({
    description: 'Additional metadata',
    type: 'object',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
