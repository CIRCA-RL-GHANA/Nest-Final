import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';
import { EntityProfile } from './entity.entity';

export enum BranchType {
  SHOP = 'Shop',
  WAREHOUSE = 'Warehouse',
  OFFICE = 'Office',
  PICKUP_POINT = 'Pickup Point',
  DELIVERY_HUB = 'Delivery Hub',
  SERVICE_CENTER = 'Service Center',
  // Content creation is a commercial activity — operated under a Digital branch.
  DIGITAL = 'Digital',
}

@Entity('branches')
export class Branch extends BaseEntity {
  @ApiProperty({
    description: 'Entity ID this branch belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  @Index()
  entityId: string;

  @ManyToOne(() => EntityProfile, { nullable: false })
  @JoinColumn({ name: 'entityId' })
  entity: EntityProfile;

  @ApiProperty({
    description: 'Branch name',
    example: 'Downtown Store',
  })
  @Column()
  name: string;

  @ApiProperty({
    description: 'Branch type/classification',
    enum: BranchType,
    example: BranchType.SHOP,
  })
  @Column({ type: 'enum', enum: BranchType })
  type: BranchType;

  @ApiProperty({
    description: 'Phone number for the branch',
    example: '+1234567890',
  })
  @Column()
  phoneNumber: string;

  @ApiProperty({
    description: 'Branch location/address',
    example: '123 Main St, City, State 12345',
  })
  @Column()
  location: string;

  @ApiProperty({
    description: 'Subscription plan ID for the branch',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  @Index()
  subscriptionPlanId: string | null;

  @ApiProperty({
    description: 'Whether the branch subscription is active',
    example: false,
  })
  @Column({ default: false })
  subscriptionActive: boolean;

  @ApiProperty({
    description: 'Branch manager user ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  @Index()
  managerId: string | null;

  @ApiProperty({
    description: 'Service scope description',
    example: 'Retail sales, customer support',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  serviceScope: string | null;

  @ApiProperty({
    description: 'Timestamp when branch was activated',
    required: false,
  })
  @Column({ type: 'timestamp with time zone', nullable: true })
  activatedAt: Date | null;

  @ApiProperty({
    description: 'Additional metadata',
    type: 'object',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
