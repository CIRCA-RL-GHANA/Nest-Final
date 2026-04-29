import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { FacilitatorProvider } from '../services/payment-facilitator.service';

/**
 * Tracks the AI Participant's cash balance in each payment facilitator's account.
 *
 * The AI Participant (TOS §5.2) maintains fully-funded accounts with every licensed
 * facilitator used on the platform. These balances are used to execute cross-facilitator
 * matched-principal bridge trades (selling to buyers in one facilitator, buying from
 * sellers in another).
 *
 * Cash imbalances across facilitators are expected and managed by the NettingEngine.
 * Rebalancing is done via ordinary business transfers (platform moving its own funds)
 * — not money transmission (TOS §4.3).
 *
 * One row per facilitator. The NettingEngine updates these balances as trades execute.
 */
@Entity('ai_facilitator_balances')
@Index('uq_ai_facilitator_balances_provider', ['facilitatorId'], { unique: true })
export class AiFacilitatorBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Which payment facilitator this balance row tracks. */
  @ApiProperty({ description: 'Payment facilitator provider ID' })
  @Column({ name: 'facilitator_id', type: 'varchar', length: 32 })
  facilitatorId: FacilitatorProvider;

  /**
   * Current cash balance in the AI's account with this facilitator (in USD).
   * Increases when AI receives cash from buyers (via this facilitator).
   * Decreases when AI sends cash to sellers (via this facilitator).
   */
  @ApiProperty({ description: 'AI cash balance at this facilitator in USD', example: 10000 })
  @Column({ name: 'cash_balance_usd', type: 'decimal', precision: 18, scale: 4, default: 0 })
  cashBalanceUsd: number;

  /**
   * Minimum reserve the platform wants to maintain at this facilitator.
   * If cashBalanceUsd falls below this, the NettingEngine creates a rebalancing task
   * and the AI reduces its available sell quantity to this facilitator's users.
   */
  @ApiProperty({ description: 'Minimum cash reserve floor in USD', example: 10000 })
  @Column({ name: 'min_reserve_usd', type: 'decimal', precision: 18, scale: 2, default: 10000 })
  minReserveUsd: number;

  /**
   * When true, the AI will place bridge orders for users of this facilitator.
   * Set to false automatically when cashBalanceUsd < minReserveUsd, and restored
   * once the platform rebalances the account (via a completed NettingTask).
   */
  @ApiProperty({ description: 'Whether the AI bridge is active for this facilitator' })
  @Column({ name: 'is_bridge_active', type: 'boolean', default: true })
  isBridgeActive: boolean;

  /**
   * Rolling 24-hour cash outflow volume (USD) — tracks how much cash the AI has sent
   * to sellers via this facilitator in the last 24 hours. Used to calculate dynamic
   * reserve ratios (10% of daily volume rule).
   */
  @ApiProperty({ description: '24-hour outflow volume in USD', example: 5000 })
  @Column({ name: 'daily_outflow_usd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  dailyOutflowUsd: number;

  @Column({ name: 'daily_outflow_reset_at', type: 'timestamp with time zone', nullable: true })
  dailyOutflowResetAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
