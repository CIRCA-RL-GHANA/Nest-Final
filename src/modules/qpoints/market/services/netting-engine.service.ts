import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { AiFacilitatorBalance } from '../entities/ai-facilitator-balance.entity';
import { NettingTask, NettingTaskStatus } from '../entities/netting-task.entity';
import { CrossFacilitatorEngineService } from './cross-facilitator-engine.service';
import { FacilitatorProvider } from './payment-facilitator.service';

/**
 * When the AI's cash at any facilitator deviates more than this from its minimum
 * reserve, the NettingEngine creates a rebalancing task.
 */
const REBALANCING_DEVIATION_THRESHOLD_USD = 5_000;

/**
 * Netting Engine — AI Cash Position Management
 *
 * Runs every hour to calculate the AI Participant's net cash position across all
 * facilitators. When a facilitator's balance deviates beyond the configured threshold,
 * a NettingTask is created for the platform finance team.
 *
 * Rebalancing mechanism:
 *   The platform wires its own operational funds from the surplus facilitator account
 *   to the deficit facilitator account. This is NOT money transmission — the platform
 *   is moving its own funds between its own licensed facilitator accounts.
 *
 *   These transfers are done off-chain (outside the QP market) and can be batched
 *   weekly unless a deficit is urgent (bridge suspended).
 *
 * Pricing nudge (alternative to immediate rebalancing):
 *   If the spread is insufficient, the NettingEngine can signal the CrossFacilitatorEngine
 *   to temporarily increase spreads to nudge trades toward the needed direction.
 *   (Not implemented in this version; left as extension point.)
 *
 * Legal basis (TOS §4.3):
 *   The platform moving its own funds between its own accounts is an ordinary business
 *   treasury operation. It is NOT money transmission and does NOT constitute the platform
 *   facilitating a user-to-user fiat transfer.
 */
@Injectable()
export class NettingEngineService {
  private readonly logger = new Logger(NettingEngineService.name);

  constructor(
    @InjectRepository(AiFacilitatorBalance)
    private readonly aiFacilitatorBalanceRepo: Repository<AiFacilitatorBalance>,
    @InjectRepository(NettingTask)
    private readonly nettingTaskRepo: Repository<NettingTask>,
    private readonly crossFacilitatorEngine: CrossFacilitatorEngineService,
  ) {}

  // =========================================================================
  // Scheduled runner — every hour
  // =========================================================================

  /**
   * Hourly netting run.
   *
   * 1. Load all AI facilitator balances.
   * 2. Identify surplus facilitators (balance significantly above minimum reserve).
   * 3. Identify deficit facilitators (balance below minimum reserve or bridge suspended).
   * 4. Create NettingTasks for each surplus→deficit pair.
   * 5. Log a summary for admin dashboard visibility.
   */
  @Cron('0 * * * *') // Every hour at minute 0
  async runNetting(): Promise<void> {
    try {
      await this._runNettingInternal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`NettingEngine run failed: ${msg}`);
    }
  }

  private async _runNettingInternal(): Promise<void> {
    const balances = await this.aiFacilitatorBalanceRepo.find();
    if (balances.length === 0) {
      this.logger.debug('NettingEngine: no facilitator balance rows — nothing to net');
      return;
    }

    // Compute net positions
    const deficits: Array<{ facilitatorId: FacilitatorProvider; deficit: number }> = [];
    const surpluses: Array<{ facilitatorId: FacilitatorProvider; surplus: number }> = [];

    for (const b of balances) {
      const balance = Number(b.cashBalanceUsd);
      const minReserve = Number(b.minReserveUsd);

      if (balance < minReserve) {
        deficits.push({
          facilitatorId: b.facilitatorId as FacilitatorProvider,
          deficit: minReserve - balance,
        });
      } else if (balance - minReserve > REBALANCING_DEVIATION_THRESHOLD_USD) {
        surpluses.push({
          facilitatorId: b.facilitatorId as FacilitatorProvider,
          surplus: balance - minReserve,
        });
      }
    }

    if (deficits.length === 0) {
      this.logger.log(
        `NettingEngine: all ${balances.length} facilitator balances are within reserve bounds. ` +
        `Surpluses: ${surpluses.map(s => `${s.facilitatorId}(+$${s.surplus.toFixed(2)})`).join(', ') || 'none'}`,
      );
      return;
    }

    // Create netting tasks for each deficit, sourcing from the largest surplus
    surpluses.sort((a, b) => b.surplus - a.surplus);
    deficits.sort((a, b) => b.deficit - a.deficit);

    this.logger.warn(
      `NettingEngine: ${deficits.length} facilitator(s) below reserve. ` +
      `Deficits: ${deficits.map(d => `${d.facilitatorId}(-$${d.deficit.toFixed(2)})`).join(', ')}. ` +
      `Creating rebalancing tasks...`,
    );

    for (const deficit of deficits) {
      // Check if a pending task already exists for this target facilitator
      const existingTask = await this.nettingTaskRepo.findOne({
        where: {
          targetFacilitatorId: deficit.facilitatorId,
          status: NettingTaskStatus.PENDING,
        },
      });

      if (existingTask) {
        this.logger.debug(
          `NettingEngine: pending task already exists for ${deficit.facilitatorId} ` +
          `(task ${existingTask.id}, $${existingTask.amountUsd})`,
        );
        continue;
      }

      // Find a surplus facilitator to source funds from
      const sourceSurplus = surpluses.find(s => s.facilitatorId !== deficit.facilitatorId && s.surplus > 0);
      if (!sourceSurplus) {
        this.logger.warn(
          `NettingEngine: no surplus facilitator available to fund deficit at ${deficit.facilitatorId}. ` +
          'Platform finance team must inject new funds.',
        );
        continue;
      }

      const amount = Math.min(deficit.deficit, sourceSurplus.surplus);
      sourceSurplus.surplus -= amount; // Reduce available surplus

      // Load balance snapshots for audit
      const [sourceBalance, targetBalance] = await Promise.all([
        this.aiFacilitatorBalanceRepo.findOne({ where: { facilitatorId: sourceSurplus.facilitatorId } }),
        this.aiFacilitatorBalanceRepo.findOne({ where: { facilitatorId: deficit.facilitatorId } }),
      ]);

      const task = this.nettingTaskRepo.create({
        sourceFacilitatorId: sourceSurplus.facilitatorId,
        targetFacilitatorId: deficit.facilitatorId,
        amountUsd: amount,
        status: NettingTaskStatus.PENDING,
        sourceBalanceAtCreation: sourceBalance ? Number(sourceBalance.cashBalanceUsd) : null,
        targetBalanceAtCreation: targetBalance ? Number(targetBalance.cashBalanceUsd) : null,
        notes: null,
        completedByAdminId: null,
        transferReference: null,
        completedAt: null,
      });

      await this.nettingTaskRepo.save(task);

      this.logger.warn(
        `NettingEngine: REBALANCING TASK created (ID: ${task.id}): ` +
        `Transfer $${amount.toFixed(2)} from ${sourceSurplus.facilitatorId} → ${deficit.facilitatorId}. ` +
        'Action required: Platform finance team must execute this wire transfer.',
      );
    }
  }

  // =========================================================================
  // Admin API
  // =========================================================================

  /** List all netting tasks, optionally filtered by status. */
  async listNettingTasks(status?: NettingTaskStatus): Promise<NettingTask[]> {
    const where = status ? { status } : {};
    return this.nettingTaskRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /**
   * Mark a netting task as completed after the platform finance team has executed
   * the wire transfer between the two facilitator accounts.
   *
   * This also calls CrossFacilitatorEngineService.applyRebalancingTransfer() to
   * update the AI's tracked cash balances accordingly.
   */
  async completeNettingTask(
    taskId: string,
    adminUserId: string,
    transferReference: string,
    notes?: string,
  ): Promise<NettingTask> {
    const task = await this.nettingTaskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new Error(`NettingTask ${taskId} not found`);
    if (task.status !== NettingTaskStatus.PENDING && task.status !== NettingTaskStatus.IN_PROGRESS) {
      throw new Error(`NettingTask ${taskId} is already ${task.status}`);
    }

    // Apply the balance adjustments to the AI facilitator balance rows
    await this.crossFacilitatorEngine.applyRebalancingTransfer(
      task.sourceFacilitatorId as FacilitatorProvider,
      task.targetFacilitatorId as FacilitatorProvider,
      Number(task.amountUsd),
    );

    const now = new Date();
    await this.nettingTaskRepo.update({ id: taskId }, {
      status: NettingTaskStatus.COMPLETED,
      completedByAdminId: adminUserId,
      transferReference,
      notes: notes ?? task.notes,
      completedAt: now,
    });

    this.logger.log(
      `NettingTask ${taskId} COMPLETED by admin ${adminUserId}: ` +
      `$${task.amountUsd} from ${task.sourceFacilitatorId} → ${task.targetFacilitatorId}, ` +
      `ref=${transferReference}`,
    );

    return (await this.nettingTaskRepo.findOne({ where: { id: taskId } }))!;
  }

  /** Cancel a pending netting task (e.g., if circumstances changed). */
  async cancelNettingTask(taskId: string, adminUserId: string, notes?: string): Promise<NettingTask> {
    const task = await this.nettingTaskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new Error(`NettingTask ${taskId} not found`);
    if (task.status !== NettingTaskStatus.PENDING) {
      throw new Error(`NettingTask ${taskId} cannot be cancelled — status is ${task.status}`);
    }

    await this.nettingTaskRepo.update({ id: taskId }, {
      status: NettingTaskStatus.CANCELLED,
      notes: notes ?? null,
      completedByAdminId: adminUserId,
      completedAt: new Date(),
    });

    this.logger.log(`NettingTask ${taskId} CANCELLED by admin ${adminUserId}`);
    return (await this.nettingTaskRepo.findOne({ where: { id: taskId } }))!;
  }

  /**
   * Get a summary of the AI's net cash position across all facilitators.
   * Used by the admin dashboard.
   */
  async getNetPositionSummary(): Promise<{
    facilitators: Array<{
      facilitatorId: string;
      cashBalanceUsd: number;
      minReserveUsd: number;
      isBridgeActive: boolean;
      dailyOutflowUsd: number;
      reserveRatio: number;
      status: 'healthy' | 'warning' | 'critical';
    }>;
    totalCashUsd: number;
    pendingTasksCount: number;
  }> {
    const [balances, pendingTasksCount] = await Promise.all([
      this.aiFacilitatorBalanceRepo.find({ order: { facilitatorId: 'ASC' } }),
      this.nettingTaskRepo.count({ where: { status: NettingTaskStatus.PENDING } }),
    ]);

    const facilitators = balances.map(b => {
      const cashBalance = Number(b.cashBalanceUsd);
      const minReserve = Number(b.minReserveUsd);
      const reserveRatio = minReserve > 0 ? cashBalance / minReserve : 1;

      let status: 'healthy' | 'warning' | 'critical';
      if (!b.isBridgeActive || reserveRatio < 0.5) {
        status = 'critical';
      } else if (reserveRatio < 1.0) {
        status = 'warning';
      } else {
        status = 'healthy';
      }

      return {
        facilitatorId: b.facilitatorId,
        cashBalanceUsd: cashBalance,
        minReserveUsd: minReserve,
        isBridgeActive: b.isBridgeActive,
        dailyOutflowUsd: Number(b.dailyOutflowUsd),
        reserveRatio: Math.round(reserveRatio * 100) / 100,
        status,
      };
    });

    const totalCashUsd = facilitators.reduce((sum, f) => sum + f.cashBalanceUsd, 0);

    return { facilitators, totalCashUsd, pendingTasksCount };
  }

  /**
   * Manually trigger a netting run (admin use — for immediate rebalancing assessment).
   */
  async triggerManualNettingRun(): Promise<void> {
    await this._runNettingInternal();
  }
}
