import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum InsuranceClaimStatus {
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID_OUT = 'paid_out',
}

@Entity('insurance_claims')
export class InsuranceClaim extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  policyId: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @ApiProperty()
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  amountClaimedQp: number;

  @ApiProperty()
  @Column({ type: 'text' })
  description: string;

  @ApiProperty({ required: false, description: 'Attachment URLs / metadata' })
  @Column({ type: 'jsonb', nullable: true })
  attachments: Record<string, any>[] | null;

  @ApiProperty({ enum: InsuranceClaimStatus })
  @Column({ type: 'enum', enum: InsuranceClaimStatus, default: InsuranceClaimStatus.SUBMITTED })
  @Index()
  status: InsuranceClaimStatus;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  reviewerNotes: string | null;

  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  payoutTxId: string | null;
}
