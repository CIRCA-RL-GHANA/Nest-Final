import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

@Entity('discount_tiers')
@Index(['productId'])
@Index(['branchId'])
@Index(['isActive'])
@Index(['validFrom', 'validTo'])
export class DiscountTier extends BaseEntity {
  @ApiProperty({
    description: 'Product ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  productId: string | null;

  @ApiProperty({
    description: 'Branch ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  branchId: string | null;

  @ApiProperty({
    description: 'Discount name',
    example: 'Summer Sale',
  })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({
    description: 'Discount description',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({
    description: 'Discount percentage',
    example: 20,
  })
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  discountPercentage: number;

  @ApiProperty({
    description: 'Minimum quantity required',
    example: 1,
  })
  @Column({ type: 'int', default: 1 })
  minQuantity: number;

  @ApiProperty({
    description: 'Maximum quantity allowed',
    required: false,
  })
  @Column({ type: 'int', nullable: true })
  maxQuantity: number | null;

  @ApiProperty({
    description: 'Minimum purchase amount required',
    required: false,
  })
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  minPurchaseAmount: number | null;

  @ApiProperty({
    description: 'Valid from date',
  })
  @Column({ type: 'timestamp' })
  validFrom: Date;

  @ApiProperty({
    description: 'Valid to date',
  })
  @Column({ type: 'timestamp' })
  validTo: Date;

  @ApiProperty({
    description: 'Whether discount is active',
    example: true,
  })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Created by user ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  createdBy: string;

  @ApiProperty({
    description: 'Applicable customer tiers',
    type: [String],
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  applicableCustomerTiers: string[] | null;
}
