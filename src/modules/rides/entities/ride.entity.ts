import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum RideStatus {
  REQUESTED = 'requested',
  DRIVER_ASSIGNED = 'driver_assigned',
  DRIVER_ARRIVED = 'driver_arrived',
  RIDE_STARTED = 'ride_started',
  RIDE_COMPLETED = 'ride_completed',
  CANCELLED = 'cancelled',
}

export enum RideType {
  STANDARD = 'standard',
  PREMIUM = 'premium',
  SHARED = 'shared',
  XL = 'xl',
}

@Entity('rides')
@Index(['riderId'])
@Index(['driverId'])
@Index(['status'])
@Index(['createdAt'])
export class Ride extends BaseEntity {
  @ApiProperty({ description: 'Ride number', example: 'RIDE-2026-00001' })
  @Column({ type: 'varchar', unique: true, length: 50 })
  rideNumber: string;

  @ApiProperty({ description: 'Rider user ID' })
  @Column({ type: 'uuid' })
  riderId: string;

  @ApiProperty({ description: 'Driver user ID', required: false })
  @Column({ type: 'uuid', nullable: true })
  driverId: string | null;

  @ApiProperty({ description: 'Vehicle ID', required: false })
  @Column({ type: 'uuid', nullable: true })
  vehicleId: string | null;

  @ApiProperty({ description: 'Ride type', enum: RideType })
  @Column({ type: 'enum', enum: RideType, default: RideType.STANDARD })
  rideType: RideType;

  @ApiProperty({ description: 'Ride status', enum: RideStatus })
  @Column({ type: 'enum', enum: RideStatus, default: RideStatus.REQUESTED })
  status: RideStatus;

  @ApiProperty({ description: 'Pickup location', type: 'object' })
  @Column({ type: 'jsonb' })
  pickupLocation: { lat: number; lng: number; address: string };

  @ApiProperty({ description: 'Dropoff location', type: 'object' })
  @Column({ type: 'jsonb' })
  dropoffLocation: { lat: number; lng: number; address: string };

  @ApiProperty({ description: 'Estimated distance in km', required: false })
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  estimatedDistance: number | null;

  @ApiProperty({ description: 'Actual distance in km', required: false })
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  actualDistance: number | null;

  @ApiProperty({ description: 'Estimated fare', required: false })
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  estimatedFare: number | null;

  @ApiProperty({ description: 'Final fare', required: false })
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  finalFare: number | null;

  @ApiProperty({ description: 'Wait time charges', required: false })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  waitTimeCharges: number;

  @ApiProperty({ description: 'Scheduled pickup time', required: false })
  @Column({ type: 'timestamp', nullable: true })
  scheduledPickupTime: Date | null;

  @ApiProperty({ description: 'When driver arrived at pickup', required: false })
  @Column({ type: 'timestamp', nullable: true })
  driverArrivedAt: Date | null;

  @ApiProperty({ description: 'When ride started', required: false })
  @Column({ type: 'timestamp', nullable: true })
  rideStartedAt: Date | null;

  @ApiProperty({ description: 'When ride completed', required: false })
  @Column({ type: 'timestamp', nullable: true })
  rideCompletedAt: Date | null;

  @ApiProperty({ description: 'Rider PIN for verification', required: false })
  @Column({ type: 'varchar', length: 6, nullable: true })
  riderPIN: string | null;

  @ApiProperty({ description: 'Driver PIN for verification', required: false })
  @Column({ type: 'varchar', length: 6, nullable: true })
  driverPIN: string | null;

  @ApiProperty({ description: 'Whether rider PIN verified' })
  @Column({ type: 'boolean', default: false })
  riderPINVerified: boolean;

  @ApiProperty({ description: 'Whether driver PIN verified' })
  @Column({ type: 'boolean', default: false })
  driverPINVerified: boolean;

  @ApiProperty({ description: 'Voice note URL for ride request', required: false })
  @Column({ type: 'text', nullable: true })
  voiceNoteUrl: string | null;

  @ApiProperty({ description: 'Special instructions', required: false })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ApiProperty({ description: 'Ride metadata', type: 'object', required: false })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
