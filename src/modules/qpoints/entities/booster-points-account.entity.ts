import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@common/entities/base.entity';
import { EntityProfile } from '@modules/entities/entities/entity.entity';
import { Branch } from '@modules/entities/entities/branch.entity';

@Entity('booster_points_accounts')
@Index(['entityId'], { unique: true, where: '"entityId" IS NOT NULL' })
@Index(['branchId'], { unique: true, where: '"branchId" IS NOT NULL' })
export class BoosterPointsAccount extends BaseEntity {
  @ApiProperty({
    description: 'Entity ID (for entity-level booster points)',
    required: false,
    example: 'uuid',
  })
  @Column({ type: 'uuid', nullable: true })
  entityId: string;

  @ApiProperty({
    description: 'Branch ID (for branch-level booster points)',
    required: false,
    example: 'uuid',
  })
  @Column({ type: 'uuid', nullable: true })
  branchId: string;

  @ApiProperty({ description: 'Current booster points balance', example: '100.00' })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balance: number;

  @ApiProperty({ description: 'Currency code', example: 'BPT', default: 'BPT' })
  @Column({ type: 'varchar', length: 10, default: 'BPT' })
  currency: string;

  @ApiProperty({ description: 'Whether account is active', example: true })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({ description: 'Total booster points earned', example: '500.00' })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalEarned: number;

  @ApiProperty({ description: 'Total booster points spent', example: '400.00' })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalSpent: number;

  @ApiProperty({ description: 'Last transaction timestamp', required: false })
  @Column({ type: 'timestamp', nullable: true })
  lastTransactionAt: Date;

  // Relations
  @ManyToOne(() => EntityProfile, { eager: false, nullable: true })
  @JoinColumn({ name: 'entityId' })
  entity: EntityProfile;

  @ManyToOne(() => Branch, { eager: false, nullable: true })
  @JoinColumn({ name: 'branchId' })
  branch: Branch;
}
