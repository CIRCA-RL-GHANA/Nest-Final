import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum PlaceVisibility {
  PRIVATE = 'private',
  PUBLIC = 'public',
  SHARED = 'shared',
}

@Entity('places')
@Index(['uniquePlaceId'], { unique: true })
@Index(['ownerId'])
@Index(['visibility'])
@Index(['category'])
@Index(['location'])
export class Place extends BaseEntity {
  @ApiProperty({
    description: 'Unique place identifier',
    example: 'PLC-2024-001',
  })
  @Column({ type: 'varchar', unique: true, length: 50 })
  uniquePlaceId: string;

  @ApiProperty({
    description: 'Place name',
    example: 'Central Park',
  })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({
    description: 'Owner ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  ownerId: string;

  @ApiProperty({
    description: 'Place visibility',
    enum: PlaceVisibility,
    example: PlaceVisibility.PUBLIC,
  })
  @Column({ type: 'enum', enum: PlaceVisibility, default: PlaceVisibility.PRIVATE })
  visibility: PlaceVisibility;

  @ApiProperty({
    description: 'Place category',
    example: 'Park',
  })
  @Column({ type: 'varchar', length: 50 })
  category: string;

  @ApiProperty({
    description: 'Place location/address',
    example: 'New York, NY',
  })
  @Column({ type: 'varchar', length: 255 })
  location: string;

  @ApiProperty({
    description: 'Geographic coordinates',
    type: 'object',
    required: false,
    example: {
      latitude: 40.785091,
      longitude: -73.968285,
    },
  })
  @Column({ type: 'jsonb', nullable: true })
  coordinates: { latitude: number; longitude: number } | null;

  @ApiProperty({
    description: 'Additional metadata',
    type: 'object',
    required: false,
    example: {
      description: 'Beautiful urban park',
      openingHours: '6:00 AM - 10:00 PM',
      amenities: ['restrooms', 'playground', 'wifi'],
    },
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @ApiProperty({
    description: 'Place tags',
    type: 'array',
    required: false,
    example: ['outdoor', 'recreation', 'family-friendly'],
  })
  @Column({ type: 'jsonb', nullable: true })
  tags: string[] | null;

  @ApiProperty({
    description: 'Whether the place is verified',
    example: true,
  })
  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @ApiProperty({
    description: 'Place rating (0-5)',
    example: 4.5,
    required: false,
  })
  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  rating: number | null;

  @ApiProperty({
    description: 'Number of reviews',
    example: 150,
  })
  @Column({ type: 'int', default: 0 })
  reviewCount: number;
}
