import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import { SubscriptionPlan, SubscriptionTier } from './entities/subscription-plan.entity';
import {
  SubscriptionAssignment,
  SubscriptionTargetType,
} from './entities/subscription-assignment.entity';
import { QPointAccount } from '@modules/qpoints/entities/qpoint-account.entity';
import { BoosterPointsAccount } from '@modules/qpoints/entities/booster-points-account.entity';
import { EntityProfile } from '@modules/entities/entities/entity.entity';
import { AuditLog } from '@modules/users/entities/audit-log.entity';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { AIPricingService } from '../ai/services/ai-pricing.service';
import { AIRecommendationsService } from '../ai/services/ai-recommendations.service';
import { RevenueService } from '@modules/revenue/revenue.service';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly FREE_PLAN_GRACE_DAYS = 30;

  /**
   * Calculate the monthly billing amount for a plan given a staff count.
   * Per-staff plans: pricePerStaffQPoints × staffCount.
   * Legacy flat plans: monthlyCostQPoints.
   */
  private calcMonthlyCost(plan: SubscriptionPlan, staffCount: number): number {
    if (Number(plan.pricePerStaffQPoints) > 0) {
      return Number(plan.pricePerStaffQPoints) * staffCount;
    }
    return Number(plan.monthlyCostQPoints);
  }

  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,
    @InjectRepository(SubscriptionAssignment)
    private readonly assignmentRepository: Repository<SubscriptionAssignment>,
    @InjectRepository(QPointAccount)
    private readonly qpointAccountRepository: Repository<QPointAccount>,
    @InjectRepository(BoosterPointsAccount)
    private readonly boosterAccountRepository: Repository<BoosterPointsAccount>,
    @InjectRepository(EntityProfile)
    private readonly entityRepository: Repository<EntityProfile>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly dataSource: DataSource,
    private readonly aiPricing: AIPricingService,
    private readonly aiRecommendations: AIRecommendationsService,
    private readonly revenueService: RevenueService,
  ) {}

  /**
   * Create a new subscription plan
   */
  async createPlan(dto: CreateSubscriptionPlanDto): Promise<SubscriptionPlan> {
    try {
      // Check if plan with same name exists
      const existing = await this.planRepository.findOne({ where: { name: dto.name } });
      if (existing) {
        throw new BadRequestException('Plan with this name already exists');
      }

      const plan = this.planRepository.create(dto);
      const saved = await this.planRepository.save(plan);

      this.logger.log(`Subscription plan created: ${saved.id} (${saved.name})`);
      return saved;
    } catch (error) {
      this.logger.error(`Error creating subscription plan: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get all subscription plans
   */
  async getAllPlans(): Promise<SubscriptionPlan[]> {
    return this.planRepository.find({ where: { isActive: true } });
  }

  /**
   * Get plan by ID
   */
  async getPlanById(id: string): Promise<SubscriptionPlan> {
    const plan = await this.planRepository.findOne({ where: { id } });
    if (!plan) {
      throw new NotFoundException('Subscription plan not found');
    }
    return plan;
  }

  /**
   * Update subscription plan
   */
  async updatePlan(id: string, dto: UpdateSubscriptionPlanDto): Promise<SubscriptionPlan> {
    const plan = await this.getPlanById(id);

    Object.assign(plan, dto);
    const updated = await this.planRepository.save(plan);

    this.logger.log(`Subscription plan updated: ${id}`);
    return updated;
  }

  /**
   * Delete subscription plan (soft delete)
   */
  async deletePlan(id: string): Promise<void> {
    await this.getPlanById(id);

    // Check if any active subscriptions use this plan
    const activeAssignments = await this.assignmentRepository.count({
      where: { planId: id, activated: true },
    });

    if (activeAssignments > 0) {
      throw new BadRequestException('Cannot delete plan with active subscriptions');
    }

    await this.planRepository.softDelete(id);
    this.logger.log(`Subscription plan deleted: ${id}`);
  }

  /**
   * Activate subscription for Entity or Branch.
   *
   * Billing rules:
   *  – Free plan: no charge.
   *  – First-time subscriber (no previous assignment for this entity): free trial
   *    month. Subscription fee is waived; all features unlocked. Transaction-fee
   *    quota is 0 during the trial period (every tx costs $0.02 immediately).
   *  – Subsequent activations: cost = plan.pricePerStaffQPoints × staffCount
   *    (or plan.monthlyCostQPoints for legacy flat plans).
   */
  async activateSubscription(
    dto: ActivateSubscriptionDto,
    userId: string,
  ): Promise<SubscriptionAssignment> {
    return this.dataSource.transaction(async (manager) => {
      // Get plan details
      const plan = await manager.findOne(SubscriptionPlan, { where: { id: dto.planId } });
      if (!plan) {
        throw new NotFoundException('Subscription plan not found');
      }

      if (!plan.isActive) {
        throw new BadRequestException('Subscription plan is not active');
      }

      // Get entity for Q-Points deduction
      const entity = await manager.findOne(EntityProfile, { where: { id: dto.entityId } });
      if (!entity) {
        throw new NotFoundException('Entity not found');
      }

      // Get Q-Points account
      const qpointAccount = await manager.findOne(QPointAccount, {
        where: { entityId: dto.entityId },
      });
      if (!qpointAccount) {
        throw new NotFoundException('Q-Points account not found');
      }

      const isFree = plan.name === SubscriptionTier.FREE;
      const staffCount = dto.staffCount ?? 1;
      const monthlyCost = this.calcMonthlyCost(plan, staffCount);

      // Determine if this is the first-ever subscription (free trial eligibility)
      const previousAssignment = await manager.findOne(SubscriptionAssignment, {
        where: { targetType: dto.targetType, targetId: dto.targetId },
      });
      const isFirstSubscription = !previousAssignment;

      // Check for existing active subscription
      const existing = await manager.findOne(SubscriptionAssignment, {
        where: {
          targetType: dto.targetType,
          targetId: dto.targetId,
          activated: true,
        },
      });

      if (existing) {
        throw new BadRequestException('Active subscription already exists for this target');
      }

      // Free trial: first month subscription fee waived; no deduction
      const isInFreeTrial = isFirstSubscription && !isFree;

      if (!isFree && !isInFreeTrial) {
        // Check sufficient Q-Points
        if (Number(qpointAccount.balance) < monthlyCost) {
          await this.logAudit('Activate Subscription', 'ERROR', userId, {
            reason: 'Insufficient Q-Points',
            required: monthlyCost,
            available: qpointAccount.balance,
          });
          throw new BadRequestException('Insufficient Q-Points balance');
        }

        // Deduct Q-Points
        qpointAccount.balance = Number(qpointAccount.balance) - monthlyCost;
        qpointAccount.totalSpent = Number(qpointAccount.totalSpent) + monthlyCost;
        qpointAccount.lastTransactionAt = new Date();
        await manager.save(QPointAccount, qpointAccount);
      }

      // Calculate dates
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setDate(expiresAt.getDate() + 30);

      const freeTrialEndsAt = isInFreeTrial ? expiresAt : null;

      // Create subscription assignment
      const assignment = manager.create(SubscriptionAssignment, {
        targetType: dto.targetType,
        targetId: dto.targetId,
        planId: dto.planId,
        activated: true,
        activatedAt: now,
        expiresAt,
        autoRenew: true,
        staffCount,
        isInFreeTrial,
        freeTrialEndsAt,
      });

      const savedAssignment = await manager.save(SubscriptionAssignment, assignment);

      // Allocate booster points
      const boosterAccount = await manager.findOne(BoosterPointsAccount, {
        where:
          dto.targetType === SubscriptionTargetType.ENTITY
            ? { entityId: dto.targetId }
            : { branchId: dto.targetId },
      });

      if (boosterAccount && plan.boosterPointsAllocation > 0) {
        boosterAccount.balance = Number(boosterAccount.balance) + Number(plan.boosterPointsAllocation);
        boosterAccount.totalEarned = Number(boosterAccount.totalEarned) + Number(plan.boosterPointsAllocation);
        boosterAccount.lastTransactionAt = new Date();
        await manager.save(BoosterPointsAccount, boosterAccount);
      }

      // Update entity subscription status
      if (dto.targetType === SubscriptionTargetType.ENTITY) {
        entity.subscriptionPlanId = dto.planId;
        await manager.save(EntityProfile, entity);
      }

      // Record revenue (only when fee is actually charged)
      if (!isFree && !isInFreeTrial && monthlyCost > 0) {
        // Fire-and-forget; revenue record should not fail the activation
        this.revenueService
          .recordSubscriptionRevenue(dto.entityId, monthlyCost, staffCount, savedAssignment.id)
          .catch((err: Error) =>
            this.logger.error(`Revenue record failed for assignment ${savedAssignment.id}: ${err.message}`),
          );
      }

      // Log audit
      await this.logAudit(
        'Activate Subscription',
        'SUCCESS',
        userId,
        {
          targetType: dto.targetType,
          targetId: dto.targetId,
          planId: dto.planId,
          planName: plan.name,
          staffCount,
          monthlyCost,
          qpointsDeducted: isFree || isInFreeTrial ? 0 : monthlyCost,
          isInFreeTrial,
          boosterPointsAllocated: plan.boosterPointsAllocation,
        },
        manager,
      );

      this.logger.log(
        `Subscription activated: ${savedAssignment.id} for ${dto.targetType} ${dto.targetId}` +
          (isInFreeTrial ? ' [FREE TRIAL]' : ''),
      );
      return savedAssignment;
    });
  }

  /**
   * Get active subscription for target
   */
  async getActiveSubscription(
    targetType: SubscriptionTargetType,
    targetId: string,
  ): Promise<SubscriptionAssignment | null> {
    return this.assignmentRepository.findOne({
      where: {
        targetType,
        targetId,
        activated: true,
      },
      relations: ['plan'],
    });
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(assignmentId: string, userId: string, reason?: string): Promise<void> {
    const assignment = await this.assignmentRepository.findOne({ where: { id: assignmentId } });
    if (!assignment) {
      throw new NotFoundException('Subscription assignment not found');
    }

    assignment.activated = false;
    assignment.autoRenew = false;
    await this.assignmentRepository.save(assignment);

    await this.logAudit('Cancel Subscription', 'SUCCESS', userId, {
      assignmentId,
      targetType: assignment.targetType,
      targetId: assignment.targetId,
      ...(reason ? { reason } : {}),
    });

    this.logger.log(`Subscription cancelled: ${assignmentId}`);
  }

  /**
   * Renew expired subscriptions (called by cron job)
   */
  async renewSubscriptions(): Promise<void> {
    const now = new Date();

    const expiredSubscriptions = await this.assignmentRepository.find({
      where: {
        activated: true,
        autoRenew: true,
        expiresAt: LessThan(now),
      },
      relations: ['plan'],
    });

    this.logger.log(`Found ${expiredSubscriptions.length} expired subscriptions to renew`);

    for (const subscription of expiredSubscriptions) {
      try {
        await this.renewSubscription(subscription);
      } catch (error) {
        this.logger.error(`Failed to renew subscription ${subscription.id}: ${error.message}`);
      }
    }
  }

  /**
   * Private helper to renew a single subscription
   */
  private async renewSubscription(assignment: SubscriptionAssignment): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const plan = assignment.plan;

      // Find entity for Q-Points deduction
      let entityId: string;
      if (assignment.targetType === SubscriptionTargetType.ENTITY) {
        entityId = assignment.targetId;
      } else {
        // For branch, find parent entity
        const branch = await manager.findOne(EntityProfile, { where: { id: assignment.targetId } });
        if (!branch) {
          throw new NotFoundException('Branch not found');
        }
        entityId = branch.id;
      }

      const qpointAccount = await manager.findOne(QPointAccount, { where: { entityId } });
      if (!qpointAccount) {
        throw new NotFoundException('Q-Points account not found');
      }

      const isFree = plan.name === SubscriptionTier.FREE;
      const staffCount = assignment.staffCount ?? 1;
      const monthlyCost = this.calcMonthlyCost(plan, staffCount);

      // Free trial ends on first renewal — charge normally from here
      const wasInFreeTrial = assignment.isInFreeTrial;
      assignment.isInFreeTrial = false;
      assignment.freeTrialEndsAt = null;

      if (!isFree) {
        if (Number(qpointAccount.balance) < monthlyCost) {
          // Insufficient funds - deactivate subscription
          assignment.activated = false;
          assignment.autoRenew = false;
          await manager.save(SubscriptionAssignment, assignment);

          await this.logAudit(
            'Auto-Renew Subscription',
            'ERROR',
            'system',
            {
              reason: 'Insufficient Q-Points',
              assignmentId: assignment.id,
              required: monthlyCost,
              available: qpointAccount.balance,
            },
            manager,
          );
          return;
        }

        // Deduct Q-Points
        qpointAccount.balance = Number(qpointAccount.balance) - monthlyCost;
        qpointAccount.totalSpent = Number(qpointAccount.totalSpent) + monthlyCost;
        qpointAccount.lastTransactionAt = new Date();
        await manager.save(QPointAccount, qpointAccount);
      }

      // Extend expiry by 30 days
      const newExpiryDate = new Date(assignment.expiresAt);
      newExpiryDate.setDate(newExpiryDate.getDate() + 30);

      assignment.expiresAt = newExpiryDate;
      assignment.lastRenewalAt = new Date();
      await manager.save(SubscriptionAssignment, assignment);

      // Allocate booster points
      const boosterAccount = await manager.findOne(BoosterPointsAccount, {
        where:
          assignment.targetType === SubscriptionTargetType.ENTITY
            ? { entityId: assignment.targetId }
            : { branchId: assignment.targetId },
      });

      if (boosterAccount && plan.boosterPointsAllocation > 0) {
        boosterAccount.balance = Number(boosterAccount.balance) + Number(plan.boosterPointsAllocation);
        boosterAccount.totalEarned = Number(boosterAccount.totalEarned) + Number(plan.boosterPointsAllocation);
        boosterAccount.lastTransactionAt = new Date();
        await manager.save(BoosterPointsAccount, boosterAccount);
      }

      // Record revenue
      if (!isFree && monthlyCost > 0) {
        this.revenueService
          .recordSubscriptionRevenue(entityId, monthlyCost, staffCount, assignment.id)
          .catch((err: Error) =>
            this.logger.error(`Revenue record failed for renewal ${assignment.id}: ${err.message}`),
          );
      }

      await this.logAudit(
        'Auto-Renew Subscription',
        'SUCCESS',
        'system',
        {
          assignmentId: assignment.id,
          planId: plan.id,
          staffCount,
          monthlyCost,
          qpointsDeducted: isFree ? 0 : monthlyCost,
          wasInFreeTrial,
          boosterPointsAllocated: plan.boosterPointsAllocation,
          newExpiryDate,
        },
        manager,
      );

      this.logger.log(`Subscription renewed: ${assignment.id}`);
    });
  }

  /**
   * Private helper to log audit events
   */
  private async logAudit(
    action: string,
    status: string,
    userId: string,
    metadata: any,
    manager?: any,
  ): Promise<void> {
    const auditLog = {
      action,
      status,
      userId,
      metadata,
      timestamp: new Date(),
    };

    if (manager) {
      await manager.save(AuditLog, auditLog);
    } else {
      await this.auditLogRepository.save(auditLog);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AI-POWERED SUBSCRIPTION INTELLIGENCE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get a personalised retention offer for a subscriber at risk of churning.
   * Uses AIPricingService.suggestRetentionDiscount.
   */
  async getAIRetentionOffer(
    assignmentId: string,
    monthsSubscribed: number,
    loginDaysAgo: number,
    featureUsageScore: number,
  ) {
    const assignment = await this.assignmentRepository.findOne({
      where: { id: assignmentId },
      relations: ['plan'],
    });

    if (!assignment?.plan) {
      throw new NotFoundException('Subscription assignment not found');
    }

    const offer = this.aiPricing.suggestRetentionDiscount(
      monthsSubscribed,
      loginDaysAgo,
      featureUsageScore,
      Number(assignment.plan.monthlyCostQPoints),
    );

    this.logger.log(`[AI] Retention offer for ${assignmentId}: ${JSON.stringify(offer)}`);
    return offer;
  }

  /**
   * Recommend the best plan for an entity based on their usage behaviour.
   */
  async getAIPlanRecommendation(currentTier: string, monthlyUsageScore: number) {
    const plans = await this.planRepository.find({ where: { isActive: true } });

    const planVectors = plans.map((p) => ({
      id: p.id,
      name: p.name,
      tier: p.name,
      featureScore:
        p.maxBranches != null && p.maxBranches > 0 ? Math.min(1, p.maxBranches / 10) : 0.1,
      price: Number(p.monthlyCostQPoints),
    }));

    return this.aiRecommendations.recommendSubscriptionPlan(
      monthlyUsageScore,
      currentTier,
      planVectors,
    );
  }
}
