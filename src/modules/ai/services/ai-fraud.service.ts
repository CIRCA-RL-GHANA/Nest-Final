import { Injectable, Logger } from '@nestjs/common';
import { AITensorflowService } from './ai-tensorflow.service';

export interface FraudSignal {
  name: string;
  risk: number; // 0–1
  detail: string;
}

export interface FraudCheckResult {
  riskScore: number; // 0–1
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  signals: FraudSignal[];
  blocked: boolean; // auto-block when critical
  reviewFlag: boolean; // flag for manual review
  reason: string;
}

export interface TransactionContext {
  userId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  ipAddress?: string;
  deviceId?: string;
  latitude?: number;
  longitude?: number;
  /** Prior transactions for velocity checks */
  recentAmounts?: number[];
  recentCountInHour?: number;
  avgHistoricAmount?: number;
}

@Injectable()
export class AIFraudService {
  private readonly logger = new Logger(AIFraudService.name);

  // Known high-risk patterns (e.g., virtual/prepaid card prefixes)
  private readonly HIGH_RISK_METHODS = new Set(['virtual_card', 'prepaid', 'gift_card']);
  private readonly MAX_HOURLY_TXN = 10;
  private readonly MAX_DEVIATION_X = 5; // 5× a user's average = anomaly
  private readonly BLOCK_THRESHOLD = 0.85;
  private readonly REVIEW_THRESHOLD = 0.55;

  constructor(private readonly tfService: AITensorflowService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN FRAUD SCORE
  // ─────────────────────────────────────────────────────────────────────────

  scoreTransaction(ctx: TransactionContext): FraudCheckResult {
    const signals: FraudSignal[] = [];

    // 1. Velocity check
    const hourlyCount = ctx.recentCountInHour ?? 0;
    if (hourlyCount >= this.MAX_HOURLY_TXN) {
      signals.push({
        name: 'velocity_breach',
        risk: Math.min(1, 0.5 + (hourlyCount - this.MAX_HOURLY_TXN) * 0.05),
        detail: `${hourlyCount} transactions in the last hour (limit ${this.MAX_HOURLY_TXN})`,
      });
    }

    // 2. Amount anomaly vs. historic average
    if (ctx.avgHistoricAmount && ctx.avgHistoricAmount > 0) {
      const ratio = ctx.amount / ctx.avgHistoricAmount;
      if (ratio > this.MAX_DEVIATION_X) {
        signals.push({
          name: 'amount_anomaly',
          risk: Math.min(1, 0.4 + (ratio - this.MAX_DEVIATION_X) * 0.05),
          detail: `Amount ${ctx.amount} is ${ratio.toFixed(1)}× the user's average`,
        });
      }
    }

    // 3. High-risk payment method
    if (this.HIGH_RISK_METHODS.has(ctx.paymentMethod?.toLowerCase())) {
      signals.push({
        name: 'risky_payment_method',
        risk: 0.4,
        detail: `Payment method "${ctx.paymentMethod}" is high-risk`,
      });
    }

    // 4. Round-number pattern (common in card testing attacks)
    if (ctx.amount % 100 === 0 && ctx.amount >= 1000) {
      signals.push({
        name: 'round_number_pattern',
        risk: 0.2,
        detail: 'Suspiciously round transaction amount',
      });
    }

    // 5. Late-night high-value transaction
    const hour = new Date().getHours();
    if (hour >= 1 && hour <= 5 && ctx.amount > 500) {
      signals.push({
        name: 'late_night_high_value',
        risk: 0.3,
        detail: 'High-value transaction at unusual hour',
      });
    }

    // 6. Multiple devices / IPs in same session (if tracked externally and passed in)
    if (ctx.recentAmounts && ctx.recentAmounts.length >= 5) {
      const allSame = new Set(ctx.recentAmounts).size <= 2;
      if (allSame) {
        signals.push({
          name: 'duplicate_amount_pattern',
          risk: 0.6,
          detail: 'Repeated identical amounts — possible card testing',
        });
      }
    }

    // Aggregate risk score (weighted max + mean composite)
    const riskScore = this.aggregateRisk(signals);
    const riskLevel = this.classifyRisk(riskScore);

    this.logger.log(
      `Fraud check for user ${ctx.userId}: score=${riskScore} level=${riskLevel} signals=${signals.length}`,
    );

    return {
      riskScore,
      riskLevel,
      signals,
      blocked: riskScore >= this.BLOCK_THRESHOLD,
      reviewFlag: riskScore >= this.REVIEW_THRESHOLD && riskScore < this.BLOCK_THRESHOLD,
      reason: signals.length
        ? signals.map((s) => s.detail).join('; ')
        : 'No suspicious signals detected',
    };
  }

  /**
   * TF-enhanced fraud scoring (async). Blends TF model (60%) with rule-based
   * score (40%). Falls back to rule-based result when TF model is unavailable.
   * Controllers should call this instead of scoreTransaction() for AI endpoints.
   */
  async scoreTransactionAsync(ctx: TransactionContext): Promise<FraudCheckResult> {
    const ruleResult = this.scoreTransaction(ctx);

    if (!this.tfService.isEnabled() || !this.tfService.hasModel('fraud')) {
      return ruleResult;
    }

    const hour = new Date().getHours();
    const avgAmount = (ctx as any).avgHistoricAmount ?? ctx.amount;
    const recentAmounts: number[] = (ctx as any).recentAmounts ?? [];
    const isDuplicatePattern =
      recentAmounts.length >= 5 && new Set(recentAmounts).size <= 2;
    const isHighRiskMethod = this.HIGH_RISK_METHODS.has(
      ctx.paymentMethod?.toLowerCase() ?? '',
    );

    const features = [
      Math.log(ctx.amount + 1) / Math.log(100_000),
      Math.min(((ctx as any).recentCountInHour ?? 0) / 20, 1),
      Math.min((avgAmount > 0 ? ctx.amount / avgAmount : 1) / 10, 1),
      isHighRiskMethod ? 1 : 0,
      ctx.amount % 100 === 0 && ctx.amount >= 1000 ? 1 : 0,
      hour >= 1 && hour <= 5 ? 1 : 0,
      isDuplicatePattern ? 1 : 0,
    ];

    try {
      const tfResult = await this.tfService.predict('fraud', [features]);
      const tfScore = tfResult.values[0]?.[0];
      if (tfScore === undefined) return ruleResult;

      const blendedScore = parseFloat(
        (0.6 * tfScore + 0.4 * ruleResult.riskScore).toFixed(4),
      );
      const riskLevel = this.classifyRisk(blendedScore);

      return {
        ...ruleResult,
        riskScore: blendedScore,
        riskLevel,
        blocked: blendedScore >= this.BLOCK_THRESHOLD,
        reviewFlag:
          blendedScore >= this.REVIEW_THRESHOLD &&
          blendedScore < this.BLOCK_THRESHOLD,
        reason: `[TF+Rule] ${ruleResult.reason}`,
      };
    } catch (err) {
      this.logger.warn(`TF fraud inference failed, using rule result: ${err}`);
      return ruleResult;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ANOMALOUS LOCATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns a location risk score given two coordinates (user's home vs txn location).
   * Haversine-based distance; > 500 km is suspicious.
   */
  scoreLocationAnomaly(
    knownLat: number,
    knownLng: number,
    txnLat: number,
    txnLng: number,
  ): FraudSignal | null {
    const distKm = this.haversineKm(knownLat, knownLng, txnLat, txnLng);
    if (distKm > 500) {
      return {
        name: 'geo_anomaly',
        risk: Math.min(1, 0.3 + distKm / 5000),
        detail: `Transaction ~${Math.round(distKm)} km from usual location`,
      };
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INTERNALS
  // ─────────────────────────────────────────────────────────────────────────

  private aggregateRisk(signals: FraudSignal[]): number {
    if (signals.length === 0) return 0;
    const mean = signals.reduce((s, sig) => s + sig.risk, 0) / signals.length;
    const max = Math.max(...signals.map((s) => s.risk));
    // Weighted: 60% max signal, 40% mean
    return parseFloat(Math.min(1, max * 0.6 + mean * 0.4).toFixed(4));
  }

  private classifyRisk(score: number): FraudCheckResult['riskLevel'] {
    if (score >= 0.85) return 'critical';
    if (score >= 0.55) return 'high';
    if (score >= 0.3) return 'medium';
    return 'low';
  }

  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }
}
