import { Injectable, Logger } from '@nestjs/common';

export interface FinancialInsight {
  type: 'trend' | 'anomaly' | 'forecast' | 'recommendation' | 'alert';
  title: string;
  body: string;
  impact: 'positive' | 'negative' | 'neutral';
  confidence: number;
  metadata?: Record<string, any>;
}

export interface SpendingPattern {
  topCategories: Array<{ category: string; total: number; percentage: number }>;
  avgDailySpend: number;
  avgWeeklySpend: number;
  highestSingleExpense: number;
  largestCategory: string;
}

export interface RevenueForecaste {
  next7Days: number;
  next30Days: number;
  trend: 'up' | 'down' | 'flat';
  confidence: number;
  seasonalityNote?: string;
}

export interface CollaborativeScore {
  itemId: string;
  score: number;
  algorithm: string;
}

@Injectable()
export class AIInsightsService {
  private readonly logger = new Logger(AIInsightsService.name);

  // ─────────────────────────────────────────────────────────────────────────
  // FINANCIAL INSIGHTS (Planner)
  // ─────────────────────────────────────────────────────────────────────────

  analyseFinancials(
    incomeTransactions: Array<{ amount: number; category: string; date: Date }>,
    expenseTransactions: Array<{ amount: number; category: string; date: Date }>,
  ): FinancialInsight[] {
    const insights: FinancialInsight[] = [];

    if (!incomeTransactions.length && !expenseTransactions.length) return insights;

    const totalIncome = incomeTransactions.reduce((s, t) => s + t.amount, 0);
    const totalExpense = expenseTransactions.reduce((s, t) => s + t.amount, 0);
    const balance = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? balance / totalIncome : 0;

    // 1. Savings rate insight
    if (savingsRate < 0.1 && totalIncome > 0) {
      insights.push({
        type: 'alert',
        title: 'Low savings rate',
        body: `Your current savings rate is ${(savingsRate * 100).toFixed(1)}%. Financial advisors recommend saving at least 20% of income.`,
        impact: 'negative',
        confidence: 0.9,
        metadata: { savingsRate, totalIncome, totalExpense },
      });
    } else if (savingsRate >= 0.2) {
      insights.push({
        type: 'recommendation',
        title: 'Great savings discipline',
        body: `You are saving ${(savingsRate * 100).toFixed(1)}% of income. Consider investing the surplus for compounding returns.`,
        impact: 'positive',
        confidence: 0.88,
      });
    }

    // 2. Top expense category
    const categoryTotals: Record<string, number> = {};
    for (const t of expenseTransactions) {
      categoryTotals[t.category] = (categoryTotals[t.category] ?? 0) + t.amount;
    }
    const topCat = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
    if (topCat) {
      const pct = ((topCat[1] / totalExpense) * 100).toFixed(1);
      insights.push({
        type: 'trend',
        title: `Highest spend: ${topCat[0]}`,
        body: `${pct}% of your expenses are in "${topCat[0]}" (₦${topCat[1].toLocaleString()}). Review if this aligns with your priorities.`,
        impact: 'neutral',
        confidence: 0.92,
        metadata: { category: topCat[0], amount: topCat[1], pct },
      });
    }

    // 3. Overspend detection: if any single month > 150% of monthly average
    const monthlyExpenses = this.groupByMonth(expenseTransactions);
    const monthlyAmounts = Object.values(monthlyExpenses);
    if (monthlyAmounts.length > 1) {
      const avg = monthlyAmounts.reduce((s, v) => s + v, 0) / monthlyAmounts.length;
      const max = Math.max(...monthlyAmounts);
      if (max > avg * 1.5) {
        insights.push({
          type: 'anomaly',
          title: 'Unusual spending spike',
          body: `One of your months had ₦${max.toLocaleString()} in expenses — ${((max / avg - 1) * 100).toFixed(0)}% above your average. Check for unexpected charges.`,
          impact: 'negative',
          confidence: 0.85,
          metadata: { peakMonth: max, averageMonth: avg },
        });
      }
    }

    // 4. Income consistency
    const monthlyIncome = this.groupByMonth(incomeTransactions);
    const incomeVals = Object.values(monthlyIncome);
    if (incomeVals.length >= 2) {
      const coeffVariation = this.coeffOfVariation(incomeVals);
      if (coeffVariation > 0.35) {
        insights.push({
          type: 'alert',
          title: 'Income volatility detected',
          body: `Your monthly income varies significantly (CV=${(coeffVariation * 100).toFixed(0)}%). Building a 3-month emergency fund could provide stability.`,
          impact: 'negative',
          confidence: 0.78,
        });
      }
    }

    return insights;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SPENDING PATTERN SUMMARY
  // ─────────────────────────────────────────────────────────────────────────

  getSpendingPattern(
    transactions: Array<{ amount: number; category: string; date: Date }>,
  ): SpendingPattern {
    if (!transactions.length) {
      return { topCategories: [], avgDailySpend: 0, avgWeeklySpend: 0, highestSingleExpense: 0, largestCategory: 'none' };
    }
    const total = transactions.reduce((s, t) => s + t.amount, 0);
    const days = Math.max(
      1,
      this.daysBetween(
        Math.min(...transactions.map((t) => t.date.getTime())),
        Math.max(...transactions.map((t) => t.date.getTime())),
      ),
    );

    const categoryTotals: Record<string, number> = {};
    for (const t of transactions) {
      categoryTotals[t.category] = (categoryTotals[t.category] ?? 0) + t.amount;
    }

    const topCategories = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, catTotal]) => ({
        category,
        total: catTotal,
        percentage: parseFloat(((catTotal / total) * 100).toFixed(1)),
      }));

    return {
      topCategories,
      avgDailySpend: parseFloat((total / days).toFixed(2)),
      avgWeeklySpend: parseFloat((total / Math.max(1, days / 7)).toFixed(2)),
      highestSingleExpense: Math.max(...transactions.map((t) => t.amount)),
      largestCategory: topCategories[0]?.category ?? 'none',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REVENUE FORECAST (simple linear trend)
  // ─────────────────────────────────────────────────────────────────────────

  forecastRevenue(dailySales: Array<{ date: Date; revenue: number }>): RevenueForecaste {
    if (dailySales.length < 3) {
      return { next7Days: 0, next30Days: 0, trend: 'flat', confidence: 0.3 };
    }

    const sorted = [...dailySales].sort((a, b) => a.date.getTime() - b.date.getTime());
    const n = sorted.length;
    const values = sorted.map((d) => d.revenue);

    // Simple linear regression
    const { slope, intercept } = this.linearRegression(values);

    const lastY = values[n - 1];
    const next7 = Math.max(0, lastY + slope * 7 + intercept / n);
    const next30 = Math.max(0, lastY + slope * 30 + intercept / n);

    const trend: RevenueForecaste['trend'] =
      slope > lastY * 0.005 ? 'up' : slope < -lastY * 0.005 ? 'down' : 'flat';

    // Weekly seasonality note
    const weeklyAvg = this.groupByDayOfWeek(sorted);
    const peakDay = Object.entries(weeklyAvg).sort((a, b) => b[1] - a[1])[0];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return {
      next7Days: parseFloat(next7.toFixed(2)),
      next30Days: parseFloat(next30.toFixed(2)),
      trend,
      confidence: Math.min(0.9, 0.5 + (n / 100) * 0.4),
      seasonalityNote: peakDay
        ? `Peak sales typically occur on ${dayNames[Number(peakDay[0])]}`
        : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COLLABORATIVE FILTERING (simple cosine similarity on user-item vectors)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Given a target user's item interaction vector and a map of all users'
   * interaction vectors, return item IDs the target user has NOT interacted
   * with but similar users have — ranked by predicted affinity.
   *
   * @param targetVector  { itemId: score } for target user
   * @param allVectors    Map<userId, { itemId: score }> for all users
   * @param topN          number of recommendations
   */
  collaborativeFilter(
    targetVector: Record<string, number>,
    allVectors: Record<string, Record<string, number>>,
    topN = 10,
  ): CollaborativeScore[] {
    const targetItems = new Set(Object.keys(targetVector));
    const userSimilarities: Array<{ userId: string; sim: number }> = [];

    for (const [userId, uvec] of Object.entries(allVectors)) {
      const sim = this.cosineSimilarity(targetVector, uvec);
      if (sim > 0) userSimilarities.push({ userId, sim });
    }

    // Sort by similarity, take top-5 neighbours
    const neighbours = userSimilarities.sort((a, b) => b.sim - a.sim).slice(0, 5);

    // Aggregate item scores from neighbours
    const itemScores: Record<string, number> = {};
    for (const { userId, sim } of neighbours) {
      for (const [itemId, score] of Object.entries(allVectors[userId])) {
        if (!targetItems.has(itemId)) {
          itemScores[itemId] = (itemScores[itemId] ?? 0) + score * sim;
        }
      }
    }

    return Object.entries(itemScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([itemId, score]) => ({
        itemId,
        score: parseFloat(score.toFixed(4)),
        algorithm: 'user-based-cf',
      }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private groupByMonth(txns: Array<{ amount: number; date: Date }>): Record<string, number> {
    const map: Record<string, number> = {};
    for (const t of txns) {
      const key = `${t.date.getFullYear()}-${t.date.getMonth()}`;
      map[key] = (map[key] ?? 0) + t.amount;
    }
    return map;
  }

  private groupByDayOfWeek(items: Array<{ date: Date; revenue: number }>): Record<number, number> {
    const map: Record<number, number> = {};
    for (const item of items) {
      const d = item.date.getDay();
      map[d] = (map[d] ?? 0) + item.revenue;
    }
    return map;
  }

  private coeffOfVariation(values: number[]): number {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    if (mean === 0) return 0;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance) / mean;
  }

  private daysBetween(msStart: number, msEnd: number): number {
    return Math.round((msEnd - msStart) / (1000 * 60 * 60 * 24)) || 1;
  }

  private linearRegression(values: number[]): { slope: number; intercept: number } {
    const n = values.length;
    const xs = values.map((_, i) => i);
    const meanX = xs.reduce((s, x) => s + x, 0) / n;
    const meanY = values.reduce((s, y) => s + y, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - meanX) * (values[i] - meanY), 0);
    const den = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
    const slope = den !== 0 ? num / den : 0;
    const intercept = meanY - slope * meanX;
    return { slope, intercept };
  }

  private cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let dot = 0,
      magA = 0,
      magB = 0;
    for (const k of keys) {
      const va = a[k] ?? 0;
      const vb = b[k] ?? 0;
      dot += va * vb;
      magA += va * va;
      magB += vb * vb;
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }
}
