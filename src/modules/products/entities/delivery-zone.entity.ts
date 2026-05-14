import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

@Entity('delivery_zones')
@Index(['branchId'])
@Index(['active'])
export class DeliveryZone extends BaseEntity {
  @ApiProperty({
    description: 'Branch ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  branchId: string;

  @ApiProperty({
    description: 'Zone name',
    example: 'Downtown Area',
  })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({
    description: 'Zone center coordinates',
    type: 'object',
    example: { latitude: 40.7128, longitude: -74.006 },
  })
  @Column({ type: 'jsonb' })
  location: { latitude: number; longitude: number };

  @ApiProperty({
    description: 'Radius in meters',
    example: 3218,
  })
  @Column({ type: 'float', default: 3218 })
  radiusMeters: number;

  @ApiProperty({
    description: 'Delivery fee in cedis',
    example: 5.0,
  })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  feeCedis: number;

  @ApiProperty({
    description: 'Minimum order amount',
    example: 20.0,
  })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  minOrderAmount: number;

  @ApiProperty({
    description: 'Estimated delivery time in minutes',
    example: 45,
  })
  @Column({ type: 'int', default: 45 })
  estimatedDeliveryTime: number;

  @ApiProperty({
    description: 'Whether zone is active',
    example: true,
  })
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @ApiProperty({
    description: 'Operating hours',
    type: 'object',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  operatingHours: Record<string, any> | null;
}
