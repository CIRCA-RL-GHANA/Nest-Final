import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';
import { User } from '../../users/entities/user.entity';

export enum EntityType {
  INDIVIDUAL = 'Individual',
  OTHER = 'Other',
}

export enum OtherEntityType {
  SOLE_PROPRIETOR = 'Sole Proprietor',
  PARTNERSHIP = 'Partnership',
  COMPANY = 'Company',
  PUBLIC_FIGURE = 'Public Figure',
  TRUST = 'Trust',
  CLUB_ASSOCIATION = 'Club/Association',
  NGO = 'NGO',
  GOVERNMENT_AGENCY = 'Government Agency',
}

@Entity('entities')
export class EntityProfile extends BaseEntity {
  @ApiProperty({
    description: 'Type of entity',
    enum: EntityType,
    example: EntityType.INDIVIDUAL,
  })
  @Column({ type: 'enum', enum: EntityType })
  @Index()
  type: EntityType;

  @ApiProperty({
    description: 'Wire ID (unique identifier)',
    example: '@johndoe',
  })
  @Column({ type: 'varchar', unique: true })
  @Index()
  wireId: string;

  @ApiProperty({
    description: 'Social username',
    example: 'john_doe',
  })
  @Column({ type: 'varchar', unique: true })
  @Index()
  socialUsername: string;

  @ApiProperty({
    description: 'Owner user ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  @Index()
  ownerId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @ApiProperty({
    description: 'Entity name (for Other Entities)',
    example: 'Acme Corporation',
    required: false,
  })
  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @ApiProperty({
    description: 'Other entity type',
    enum: OtherEntityType,
    required: false,
  })
  @Column({ type: 'enum', enum: OtherEntityType, nullable: true })
  otherEntityType: OtherEntityType | null;

  @ApiProperty({
    description: 'Phone number for the entity',
    example: '+1234567890',
    required: false,
  })
  @Column({ type: 'varchar', nullable: true })
  phoneNumber: string | null;

  @ApiProperty({
    description: 'Subscription plan ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  @Index()
  subscriptionPlanId: string | null;

  @ApiProperty({
    description: 'Whether the entity is verified',
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @ApiProperty({
    description: 'Created by user ID (for Other Entities)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ApiProperty({
    description: 'Additional metadata',
    type: 'object',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
