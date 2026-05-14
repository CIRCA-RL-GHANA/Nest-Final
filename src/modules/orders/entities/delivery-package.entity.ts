import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

@Entity('delivery_packages')
@Index(['driverId'])
@Index(['createdAt'])
export class DeliveryPackage extends BaseEntity {
  @ApiProperty({ description: 'Package number', example: 'PKG-2026-00001' })
  @Column({ type: 'varchar', unique: true, length: 50 })
  packageNumber: string;

  @ApiProperty({ description: 'Driver ID' })
  @Column({ type: 'uuid' })
  driverId: string;

  @ApiProperty({ description: 'Total orders in package' })
  @Column({ type: 'int', default: 0 })
  totalOrders: number;

  @ApiProperty({ description: 'Delivery route sequence', type: [Object], required: false })
  @Column({ type: 'jsonb', nullable: true })
  route: Array<{
    orderId: string;
    sequence: number;
    location: { lat: number; lng: number };
  }> | null;

  @ApiProperty({ description: 'Whether package is completed' })
  @Column({ type: 'boolean', default: false })
  isCompleted: boolean;

  @ApiProperty({ description: 'When package was completed', required: false })
  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
