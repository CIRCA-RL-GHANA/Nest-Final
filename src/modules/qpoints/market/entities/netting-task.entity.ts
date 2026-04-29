import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { FacilitatorProvider } from '../services/payment-facilitator.service';

export enum NettingTaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

/**
 * A rebalancing task created by the NettingEngine when the AI Participant's
 * cash position at a facilitator deviates beyond the configured threshold.
 *
 * The platform finance team (or automated transfer via facilitator API) executes
 * a wire from the surplus facilitator account to the deficit facilitator account.
 *
 * This is NOT money transmission — the platform is moving its own operational funds
 * between its own accounts at different licensed payment providers (TOS §4.3).
 *
 * Tasks are batched and can be completed weekly (or immediately if the deficit is
 * urgent enough to trigger the bridge suspension threshold).
 */
@Entity('netting_tasks')
@Index('idx_netting_tasks_status', ['status'])
export class NettingTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The facilitator with a surplus (cash flows into AI here from buyers).
   * The funds should be wired FROM this account.
   */
  @ApiProperty({ description: 'Facilitator with surplus (transfer FROM here)' })
  @Column({ name: 'source_facilitator_id', type: 'varchar', length: 32 })
  sourceFacilitatorId: FacilitatorProvider;

  /**
   * The facilitator with a deficit (AI is sending cash to sellers here).
   * The funds should be wired TO this account.
   */
  @ApiProperty({ description: 'Facilitator with deficit (transfer TO here)' })
  @Column({ name: 'target_facilitator_id', type: 'varchar', length: 32 })
  targetFacilitatorId: FacilitatorProvider;

  /** USD amount to transfer from source to target. */
  @ApiProperty({ description: 'Amount in USD to rebalance', example: 5000 })
  @Column({ name: 'amount_usd', type: 'decimal', precision: 18, scale: 2 })
  amountUsd: number;

  @ApiProperty({ enum: NettingTaskStatus })
  @Column({ type: 'text', default: NettingTaskStatus.PENDING })
  status: NettingTaskStatus;

  /**
   * Snapshot of AI's balance at the source facilitator when the task was created.
   * Used for audit / reconciliation.
   */
  @Column({ name: 'source_balance_at_creation', type: 'decimal', precision: 18, scale: 2, nullable: true })
  sourceBalanceAtCreation: number | null;

  /**
   * Snapshot of AI's balance at the target facilitator when the task was created.
   */
  @Column({ name: 'target_balance_at_creation', type: 'decimal', precision: 18, scale: 2, nullable: true })
  targetBalanceAtCreation: number | null;

  /** Optional admin notes or external wire transfer reference. */
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Admin user ID who marked this task completed (for audit trail). */
  @Column({ name: 'completed_by_admin_id', type: 'uuid', nullable: true })
  completedByAdminId: string | null;

  /** Wire transfer reference number from the bank / facilitator API. */
  @Column({ name: 'transfer_reference', type: 'varchar', length: 255, nullable: true })
  transferReference: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp with time zone', nullable: true })
  completedAt: Date | null;
}
