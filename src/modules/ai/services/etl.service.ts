import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AIFeature, FeatureType } from '../entities/ai-feature.entity';
import { FeatureStoreService } from './feature-store.service';

export interface ExtractResult {
  entityType: string;
  entityId: string;
  rawData: Record<string, any>;
  extractedAt: Date;
}

export interface TransformResult {
  entityType: string;
  entityId: string;
  features: Array<{
    featureName: string;
    featureType: FeatureType;
    featureValue: any;
  }>;
}

export interface EtlJobStatus {
  pipelineName: string;
  lastRunAt: Date | null;
  lastStatus: 'idle' | 'running' | 'success' | 'error';
  lastError: string | null;
  recordsProcessed: number;
}

@Injectable()
export class EtlService {
  private readonly logger = new Logger(EtlService.name);

  // Track pipeline run state
  private readonly pipelineStatus = new Map<string, EtlJobStatus>();

  constructor(
    @InjectRepository(AIFeature)
    private readonly featureRepo: Repository<AIFeature>,
    private readonly featureStore: FeatureStoreService,
    private readonly dataSource: DataSource,
    @InjectQueue('etl-pipeline')
    private readonly etlQueue: Queue,
  ) {}

  // ─────────────────────────────────────────────────────
  // SCHEDULED PIPELINES
  // ─────────────────────────────────────────────────────

  /** Hourly: compute user activity features */
  @Cron(CronExpression.EVERY_HOUR)
  async runUserActivityPipeline(): Promise<void> {
    await this.queuePipeline('user_activity', {});
  }

  /** Every 6 hours: compute transaction risk features */
  @Cron('0 */6 * * *')
  async runTransactionFeaturePipeline(): Promise<void> {
    await this.queuePipeline('transaction_features', {});
  }

  /** Daily at midnight: compute product popularity features */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runProductFeaturePipeline(): Promise<void> {
    await this.queuePipeline('product_features', {});
  }

  // ─────────────────────────────────────────────────────
  // QUEUE + RUN
  // ─────────────────────────────────────────────────────

  async queuePipeline(pipelineName: string, options: Record<string, any>): Promise<void> {
    await this.etlQueue.add('run-pipeline', { pipelineName, options }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 20,
    });
    this.logger.log(`ETL pipeline queued: ${pipelineName}`);
  }

  async runPipeline(pipelineName: string, options: Record<string, any> = {}): Promise<EtlJobStatus> {
    const status = this.getPipelineStatus(pipelineName);
    if (status.lastStatus === 'running') {
      this.logger.warn(`Pipeline "${pipelineName}" is already running — skipping`);
      return status;
    }

    this.setPipelineStatus(pipelineName, 'running', null, 0);

    try {
      let recordsProcessed = 0;

      switch (pipelineName) {
        case 'user_activity':
          recordsProcessed = await this.runUserActivityExtract(options);
          break;
        case 'transaction_features':
          recordsProcessed = await this.runTransactionFeaturesExtract(options);
          break;
        case 'product_features':
          recordsProcessed = await this.runProductFeaturesExtract(options);
          break;
        default:
          this.logger.warn(`Unknown pipeline: ${pipelineName}`);
          recordsProcessed = 0;
      }

      this.setPipelineStatus(pipelineName, 'success', null, recordsProcessed);
      this.logger.log(`Pipeline "${pipelineName}" completed: ${recordsProcessed} records processed`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.setPipelineStatus(pipelineName, 'error', errorMsg, 0);
      this.logger.error(`Pipeline "${pipelineName}" failed: ${errorMsg}`);
    }

    return this.getPipelineStatus(pipelineName);
  }

  // ─────────────────────────────────────────────────────
  // USER ACTIVITY PIPELINE
  // ─────────────────────────────────────────────────────

  private async runUserActivityExtract(options: Record<string, any>): Promise<number> {
    const limit = options.limit ?? 500;

    // Extract: get users with recent activity
    const rows: Array<{ user_id: string; action_count: string; last_active: Date }> =
      await this.dataSource.query(
        `SELECT 
           u.id AS user_id,
           COUNT(al.id) AS action_count,
           MAX(al.created_at) AS last_active
         FROM users u
         LEFT JOIN audit_logs al ON al.user_id = u.id 
           AND al.created_at > NOW() - INTERVAL '24 hours'
         WHERE u.created_at IS NOT NULL
         GROUP BY u.id
         ORDER BY action_count DESC
         LIMIT $1`,
        [limit],
      ).catch(() => []);

    if (rows.length === 0) return 0;

    // Transform + Load
    const features = rows.flatMap((row) => [
      {
        entityType: 'user',
        entityId: row.user_id,
        featureName: 'daily_action_count',
        featureType: FeatureType.NUMERICAL,
        featureValue: parseInt(String(row.action_count), 10) || 0,
        metadata: { computedFrom: 'audit_logs', window: '24h' },
      },
      {
        entityType: 'user',
        entityId: row.user_id,
        featureName: 'last_active_at',
        featureType: FeatureType.TEXT,
        featureValue: row.last_active?.toISOString() ?? null,
        metadata: null,
      },
    ]);

    await this.featureStore.batchSetFeatures(features);
    return rows.length;
  }

  // ─────────────────────────────────────────────────────
  // TRANSACTION FEATURES PIPELINE
  // ─────────────────────────────────────────────────────

  private async runTransactionFeaturesExtract(_options: Record<string, any>): Promise<number> {
    // Extract payment transaction aggregates
    const rows: Array<{
      user_id: string;
      txn_count: string;
      total_amount: string;
      avg_amount: string;
      max_amount: string;
    }> = await this.dataSource.query(
      `SELECT 
         user_id,
         COUNT(*) AS txn_count,
         SUM(amount) AS total_amount,
         AVG(amount) AS avg_amount,
         MAX(amount) AS max_amount
       FROM payment_transactions
       WHERE created_at > NOW() - INTERVAL '7 days'
         AND status = 'completed'
       GROUP BY user_id
       ORDER BY txn_count DESC
       LIMIT 1000`,
    ).catch(() => []);

    if (rows.length === 0) return 0;

    const features = rows.flatMap((row) => [
      {
        entityType: 'user',
        entityId: row.user_id,
        featureName: 'weekly_txn_count',
        featureType: FeatureType.NUMERICAL,
        featureValue: parseInt(String(row.txn_count), 10) || 0,
      },
      {
        entityType: 'user',
        entityId: row.user_id,
        featureName: 'weekly_avg_txn_amount',
        featureType: FeatureType.NUMERICAL,
        featureValue: parseFloat(String(row.avg_amount)) || 0,
      },
      {
        entityType: 'user',
        entityId: row.user_id,
        featureName: 'weekly_max_txn_amount',
        featureType: FeatureType.NUMERICAL,
        featureValue: parseFloat(String(row.max_amount)) || 0,
      },
    ]);

    await this.featureStore.batchSetFeatures(features);
    return rows.length;
  }

  // ─────────────────────────────────────────────────────
  // PRODUCT FEATURES PIPELINE
  // ─────────────────────────────────────────────────────

  private async runProductFeaturesExtract(_options: Record<string, any>): Promise<number> {
    // Products/listings view/purchase counts
    const rows: Array<{
      product_id: string;
      view_count: string;
      purchase_count: string;
    }> = await this.dataSource.query(
      `SELECT 
         product_id,
         SUM(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END) AS view_count,
         SUM(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS purchase_count
       FROM product_analytics
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY product_id
       LIMIT 2000`,
    ).catch(() => []);

    if (rows.length === 0) return 0;

    const features = rows.flatMap((row) => [
      {
        entityType: 'product',
        entityId: row.product_id,
        featureName: 'monthly_view_count',
        featureType: FeatureType.NUMERICAL,
        featureValue: parseInt(String(row.view_count), 10) || 0,
      },
      {
        entityType: 'product',
        entityId: row.product_id,
        featureName: 'monthly_purchase_count',
        featureType: FeatureType.NUMERICAL,
        featureValue: parseInt(String(row.purchase_count), 10) || 0,
      },
    ]);

    await this.featureStore.batchSetFeatures(features);
    return rows.length;
  }

  // ─────────────────────────────────────────────────────
  // STATUS
  // ─────────────────────────────────────────────────────

  getPipelineStatus(pipelineName: string): EtlJobStatus {
    if (!this.pipelineStatus.has(pipelineName)) {
      this.pipelineStatus.set(pipelineName, {
        pipelineName,
        lastRunAt: null,
        lastStatus: 'idle',
        lastError: null,
        recordsProcessed: 0,
      });
    }
    return this.pipelineStatus.get(pipelineName)!;
  }

  getAllPipelineStatuses(): EtlJobStatus[] {
    const defaults = ['user_activity', 'transaction_features', 'product_features'];
    for (const name of defaults) this.getPipelineStatus(name);
    return Array.from(this.pipelineStatus.values());
  }

  private setPipelineStatus(
    pipelineName: string,
    status: EtlJobStatus['lastStatus'],
    error: string | null,
    recordsProcessed: number,
  ): void {
    const current = this.getPipelineStatus(pipelineName);
    current.lastStatus = status;
    current.lastError = error;
    current.recordsProcessed = recordsProcessed;
    if (status !== 'running') current.lastRunAt = new Date();
    this.pipelineStatus.set(pipelineName, current);
  }
}
