import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EnterpriseProfile } from './entities/enterprise-profile.entity';

/**
 * EnterpriseAnalyticsService
 *
 * Aggregates data from orders, products, subscriptions, webhooks, and the
 * QP ledger to provide enterprise and FI entities with a scoped dashboard
 * view of their own metrics. Only data belonging to the requesting entity
 * (or its branches) is returned — never cross-entity.
 *
 * Accessible to: ENTERPRISE_ADMIN, ENTERPRISE_OPERATOR, ENTERPRISE_VIEWER,
 * FINANCIAL_INSTITUTION, FI_AUDITOR, and ADMIN.
 */
@Injectable()
export class EnterpriseAnalyticsService {
  constructor(
    @InjectRepository(EnterpriseProfile)
    private readonly profileRepo: Repository<EnterpriseProfile>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Return a full analytics snapshot for an enterprise entity.
   * If `branchId` is supplied, scope to that branch only.
   */
  async getSnapshot(entityId: string, branchId?: string): Promise<EntityAnalyticsSnapshot> {
    const profile = await this.profileRepo.findOne({ where: { entityId } });
    if (!profile) {
      throw new NotFoundException(`Enterprise entity ${entityId} not found`);
    }

    const [orders, products, subscriptions, fees, webhooks, staffCount] = await Promise.all([
      this.getOrderStats(entityId, branchId),
      this.getProductStats(branchId ?? entityId),
      this.getSubscriptionStatus(entityId),
      this.getEntityFees(entityId),
      this.getWebhookStats(entityId),
      this.getStaffCount(entityId),
    ]);

    return {
      entityId,
      branchId: branchId ?? null,
      entityName: profile.legalName ?? entityId,
      verificationStatus: profile.status,
      tier: profile.enterpriseType,
      orders,
      products,
      subscriptions,
      fees,
      webhooks,
      staffCount,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Order stats scoped to a branch (by branchId) or entity (all branches) */
  async getOrderStats(entityId: string, branchId?: string): Promise<OrderStats> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select([
        `COUNT(*) FILTER (WHERE status = 'pending') AS pending`,
        `COUNT(*) FILTER (WHERE status = 'processing') AS processing`,
        `COUNT(*) FILTER (WHERE status = 'completed') AS completed`,
        `COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled`,
        `COUNT(*) FILTER (WHERE status = 'returned') AS returned`,
        `COUNT(*) AS total`,
        `COALESCE(SUM(total_amount) FILTER (WHERE status = 'completed'), 0) AS completed_revenue`,
        `COALESCE(SUM(total_amount) FILTER (WHERE status = 'pending'), 0) AS pending_revenue`,
      ])
      .from('orders', 'o');

    if (branchId) {
      qb.where('o.branch_id = :branchId', { branchId });
    } else {
      // Join through branches to scope to the entity
      qb.innerJoin(
        'branches',
        'b',
        'b.id = o.branch_id AND b.entity_id = :entityId',
        { entityId },
      );
    }

    const row = await qb.getRawOne();
    return {
      pending: Number(row?.pending ?? 0),
      processing: Number(row?.processing ?? 0),
      completed: Number(row?.completed ?? 0),
      cancelled: Number(row?.cancelled ?? 0),
      returned: Number(row?.returned ?? 0),
      total: Number(row?.total ?? 0),
      completedRevenue: parseFloat(row?.completed_revenue ?? '0'),
      pendingRevenue: parseFloat(row?.pending_revenue ?? '0'),
    };
  }

  /** Product catalog stats scoped to a branch */
  async getProductStats(branchId: string): Promise<ProductStats> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select([
        `COUNT(*) AS total`,
        `COUNT(*) FILTER (WHERE status = 'active') AS active`,
        `COUNT(*) FILTER (WHERE status = 'inactive') AS inactive`,
        `COUNT(*) FILTER (WHERE stock_quantity = 0) AS out_of_stock`,
        `COUNT(*) FILTER (WHERE is_featured = true) AS featured`,
        `COALESCE(AVG(price), 0) AS avg_price`,
      ])
      .from('products', 'p')
      .where('p.branch_id = :branchId', { branchId })
      .getRawOne();

    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      inactive: Number(row?.inactive ?? 0),
      outOfStock: Number(row?.out_of_stock ?? 0),
      featured: Number(row?.featured ?? 0),
      avgPrice: parseFloat(row?.avg_price ?? '0'),
    };
  }

  /** Active subscription status for the entity */
  async getSubscriptionStatus(entityId: string): Promise<SubscriptionStatus> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select([
        'sa.id AS assignment_id',
        'sp.name AS plan_name',
        'sp.tier AS plan_tier',
        'sa.staff_count AS staff_count',
        'sa.is_in_free_trial AS in_free_trial',
        'sa.free_trial_ends_at AS trial_ends_at',
        'sa.starts_at AS starts_at',
        'sa.ends_at AS ends_at',
        'sa.status AS status',
      ])
      .from('subscription_assignments', 'sa')
      .innerJoin('subscription_plans', 'sp', 'sp.id = sa.plan_id')
      .where("sa.target_type = 'entity'")
      .andWhere('sa.target_id = :entityId', { entityId })
      .andWhere("sa.status IN ('active', 'trial')")
      .orderBy('sa.created_at', 'DESC')
      .limit(1)
      .getRawOne();

    if (!row) return { active: false };

    return {
      active: true,
      assignmentId: row.assignment_id,
      planName: row.plan_name,
      planTier: row.plan_tier,
      staffCount: Number(row.staff_count ?? 0),
      inFreeTrial: row.in_free_trial,
      trialEndsAt: row.trial_ends_at,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    };
  }

  /** Monthly platform transaction-fee counters for this entity */
  async getEntityFees(entityId: string): Promise<EntityFees> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select([
        'btc.calendar_month AS month',
        'btc.tx_count AS tx_count',
        'btc.free_quota AS free_quota',
        'btc.billable_count AS billable_count',
        'btc.fee_qp AS fee_qp',
      ])
      .from('business_transaction_counters', 'btc')
      .where('btc.entity_id = :entityId', { entityId })
      .orderBy('btc.calendar_month', 'DESC')
      .limit(6)
      .getRawMany();

    return {
      months: rows.map((r) => ({
        month: r.month,
        txCount: Number(r.tx_count),
        freeQuota: Number(r.free_quota),
        billableCount: Number(r.billable_count),
        feeQp: parseFloat(r.fee_qp ?? '0'),
      })),
    };
  }

  /** Webhook subscription delivery health for this entity */
  async getWebhookStats(entityId: string): Promise<WebhookStats> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select([
        `COUNT(*) AS total`,
        `COUNT(*) FILTER (WHERE is_active = true) AS active`,
        `COALESCE(SUM(delivery_count), 0) AS total_deliveries`,
        `COALESCE(SUM(failure_count), 0) AS total_failures`,
      ])
      .from('webhook_subscriptions', 'ws')
      .where('ws.entity_id = :entityId', { entityId })
      .getRawOne();

    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      totalDeliveries: Number(row?.total_deliveries ?? 0),
      totalFailures: Number(row?.total_failures ?? 0),
      successRate:
        Number(row?.total_deliveries) > 0
          ? Math.round(
              ((Number(row.total_deliveries) - Number(row.total_failures)) /
                Number(row.total_deliveries)) *
                100,
            )
          : null,
    };
  }

  /** Staff/operator count — users whose entityId matches this enterprise */
  async getStaffCount(entityId: string): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'cnt')
      .from('users', 'u')
      .where('u.entity_id = :entityId', { entityId })
      .andWhere("u.role IN ('enterprise_operator', 'enterprise_viewer', 'fi_loan_officer', 'fi_teller', 'fi_auditor')")
      .getRawOne();
    return Number(row?.cnt ?? 0);
  }

  /**
   * List all branches for an enterprise entity with their order + product counts.
   * Useful for multi-entity dashboards.
   */
  async getBranchSummaries(entityId: string): Promise<BranchSummary[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select([
        'b.id AS id',
        'b.name AS name',
        'b.city AS city',
        'b.country AS country',
        'b.is_active AS is_active',
        `(SELECT COUNT(*) FROM orders o WHERE o.branch_id = b.id) AS order_count`,
        `(SELECT COUNT(*) FROM products p WHERE p.branch_id = b.id) AS product_count`,
      ])
      .from('branches', 'b')
      .where('b.entity_id = :entityId', { entityId })
      .getRawMany();

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      city: r.city,
      country: r.country,
      isActive: r.is_active,
      orderCount: Number(r.order_count),
      productCount: Number(r.product_count),
    }));
  }
}

// ── Type definitions ──────────────────────────────────────────────────────────

export interface OrderStats {
  pending: number;
  processing: number;
  completed: number;
  cancelled: number;
  returned: number;
  total: number;
  completedRevenue: number;
  pendingRevenue: number;
}

export interface ProductStats {
  total: number;
  active: number;
  inactive: number;
  outOfStock: number;
  featured: number;
  avgPrice: number;
}

export interface SubscriptionStatus {
  active: boolean;
  assignmentId?: string;
  planName?: string;
  planTier?: string;
  staffCount?: number;
  inFreeTrial?: boolean;
  trialEndsAt?: string | null;
  startsAt?: string;
  endsAt?: string | null;
}

export interface EntityFees {
  months: {
    month: string;
    txCount: number;
    freeQuota: number;
    billableCount: number;
    feeQp: number;
  }[];
}

export interface WebhookStats {
  total: number;
  active: number;
  totalDeliveries: number;
  totalFailures: number;
  successRate: number | null;
}

export interface BranchSummary {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  isActive: boolean;
  orderCount: number;
  productCount: number;
}

export interface EntityAnalyticsSnapshot {
  entityId: string;
  branchId: string | null;
  entityName: string;
  verificationStatus: string; // EnterpriseStatus enum value
  tier: string | null;      // EnterpriseType enum value
  orders: OrderStats;
  products: ProductStats;
  subscriptions: SubscriptionStatus;
  fees: EntityFees;
  webhooks: WebhookStats;
  staffCount: number;
  generatedAt: string;
}
