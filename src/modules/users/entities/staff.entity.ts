import { Entity, Column, ManyToOne, JoinColumn, Index, BeforeInsert } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import { BaseEntity } from '@/common/entities/base.entity';
import { User } from './user.entity';

// Owner is the individual entity creator — not an assignable staff role.
// It is granted automatically and can only exist under EntityType.INDIVIDUAL.
export enum StaffRole {
  ADMINISTRATOR = 'Administrator',
  SOCIAL_OFFICER = 'Social Officer',
  RESPONSE_OFFICER = 'Response Officer',
  MONITOR = 'Monitor',
  BRANCH_MANAGER = 'Branch Manager',
  DRIVER = 'Driver',
}

@Entity('staff')
export class Staff extends BaseEntity {
  @ApiProperty({
    description: 'User ID of the staff member',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({
    description: 'Entity ID the staff member belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  @Index()
  entityId: string;

  @ApiProperty({
    description: 'Role of the staff member',
    enum: StaffRole,
    example: StaffRole.ADMINISTRATOR,
  })
  @Column({ type: 'enum', enum: StaffRole })
  role: StaffRole;

  @Column({ select: false })
  pinHash: string;

  @ApiProperty({
    description: 'POS ID for Response Officers',
    example: 'POS-001',
    required: false,
  })
  @Column({ type: 'varchar', nullable: true })
  posId: string | null;

  @ApiProperty({
    description: 'Whether the staff assignment is active',
    example: true,
  })
  @Column({ default: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Branch ID if staff is assigned to a branch',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  @Index()
  branchId: string | null;

  @BeforeInsert()
  async hashPin() {
    if (this.pinHash) {
      this.pinHash = await bcrypt.hash(this.pinHash, 12);
    }
  }

  async validatePin(pin: string): Promise<boolean> {
    return bcrypt.compare(pin, this.pinHash);
  }
}
