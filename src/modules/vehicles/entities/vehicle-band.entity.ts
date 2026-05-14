import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

@Entity('vehicle_bands')
@Index(['branchId'])
@Index(['managerId'])
export class VehicleBand extends BaseEntity {
  @ApiProperty({
    description: 'Band name',
    example: 'Premium Fleet',
  })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({
    description: 'Branch ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  branchId: string;

  @ApiProperty({
    description: 'Manager (creator) ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  managerId: string;

  @ApiProperty({
    description: 'Band description',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({
    description: 'Whether band is active',
    example: true,
  })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
