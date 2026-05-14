import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum VehicleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  MAINTENANCE = 'maintenance',
  DECOMMISSIONED = 'decommissioned',
}

@Entity('vehicles')
@Index(['plateNumber'], { unique: true })
@Index(['branchId'])
@Index(['status'])
@Index(['type'])
export class Vehicle extends BaseEntity {
  @ApiProperty({
    description: 'Vehicle type',
    example: 'Sedan',
  })
  @Column({ type: 'varchar', length: 50 })
  type: string;

  @ApiProperty({
    description: 'Plate number',
    example: 'ABC-1234',
  })
  @Column({ type: 'varchar', unique: true, length: 20 })
  plateNumber: string;

  @ApiProperty({
    description: 'Branch ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  branchId: string;

  @ApiProperty({
    description: 'Passenger capacity',
    example: 4,
  })
  @Column({ type: 'int' })
  capacity: number;

  @ApiProperty({
    description: 'Base fare',
    example: 50.0,
  })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  baseFare: number;

  @ApiProperty({
    description: 'Per kilometer rate',
    example: 15.0,
  })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  perKmRate: number;

  @ApiProperty({
    description: 'Wait charge per minute',
    example: 2.5,
  })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  waitChargePerMinute: number;

  @ApiProperty({
    description: 'Vehicle status',
    enum: VehicleStatus,
    example: VehicleStatus.ACTIVE,
  })
  @Column({ type: 'enum', enum: VehicleStatus, default: VehicleStatus.ACTIVE })
  status: VehicleStatus;

  @ApiProperty({
    description: 'Sleep coordinates (where vehicle parks)',
    type: 'object',
    required: false,
    example: {
      latitude: 40.7128,
      longitude: -74.006,
    },
  })
  @Column({ type: 'jsonb', nullable: true })
  sleepCoordinates: { latitude: number; longitude: number } | null;

  @ApiProperty({
    description: 'Operational zones',
    type: 'array',
    required: false,
    example: ['Downtown', 'Airport', 'Suburbs'],
  })
  @Column({ type: 'jsonb', nullable: true })
  operationalZones: string[] | null;

  @ApiProperty({
    description: 'Vehicle model',
    required: false,
  })
  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @ApiProperty({
    description: 'Vehicle year',
    required: false,
  })
  @Column({ type: 'int', nullable: true })
  year: number | null;

  @ApiProperty({
    description: 'Vehicle color',
    required: false,
  })
  @Column({ type: 'varchar', length: 50, nullable: true })
  color: string | null;

  @ApiProperty({
    description: 'Additional metadata',
    type: 'object',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
