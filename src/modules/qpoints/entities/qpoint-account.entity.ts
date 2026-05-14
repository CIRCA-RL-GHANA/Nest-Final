import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';
import { EntityProfile } from '../../entities/entities/entity.entity';

@Entity('qpoint_accounts')
export class QPointAccount extends BaseEntity {
  @ApiProperty({
    description: 'Entity ID this Q-Points account belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid', unique: true })
  @Index()
  entityId: string;

  @ManyToOne(() => EntityProfile, { nullable: false })
  @JoinColumn({ name: 'entityId' })
  entity: EntityProfile;

  @ApiProperty({
    description: 'Current Q-Points balance',
    example: 1000.0,
  })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balance: number;

  @ApiProperty({
    description: 'Currency code',
    example: 'QP',
  })
  @Column({ type: 'varchar', default: 'QP' })
  currency: string;

  @ApiProperty({
    description: 'Whether the account is active',
    example: true,
  })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Whether the account is frozen',
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  isFrozen: boolean;

  @ApiProperty({
    description: 'Reason for freezing (if frozen)',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  freezeReason: string | null;

  @ApiProperty({
    description: 'Daily transaction limit',
    example: 10000.0,
    required: false,
  })
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  dailyLimit: number | null;

  @ApiProperty({
    description: 'Monthly transaction limit',
    example: 100000.0,
    required: false,
  })
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  monthlyLimit: number | null;

  @ApiProperty({
    description: 'Total earned Q-Points',
    example: 5000.0,
  })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalEarned: number;

  @ApiProperty({
    description: 'Total spent Q-Points',
    example: 4000.0,
  })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalSpent: number;

  @ApiProperty({
    description: 'Last transaction timestamp',
    required: false,
  })
  @Column({ type: 'timestamp with time zone', nullable: true })
  lastTransactionAt: Date | null;
}
