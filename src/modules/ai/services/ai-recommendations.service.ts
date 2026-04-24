import { Injectable, Logger } from '@nestjs/common';
import { AIInsightsService } from './ai-insights.service';
import { AINlpService } from './ai-nlp.service';
import { AITensorflowService } from './ai-tensorflow.service';

export interface RecommendedItem {
  id: string;
  score: number;
  reason: string;
}

export interface FeedItem {
  id: string;
  type: string;
  score: number;
  reason: string;
}

/**
 * AIRecommendationsService — unified recommendation engine.
 *
 * Strategy  :
 *   1. Content-based filtering via cosine similarity on feature vectors
 *   2. Collaborative filtering (user-based) via AIInsightsService
 *   3. NLP-based content matching via AINlpService cosine similarity
 *   4. Blended ranking combining both approaches
 *
 * Domain    : Products, social feed, subscriptions, wishlist, places.
 */
@Injectable()
export class AIRecommendationsService {
  private readonly logger = new Logger(AIRecommendationsService.name);

  constructor(
    private readonly insightsService: AIInsightsService,
    private readonly nlpService: AINlpService,
    private readonly tfService: AITensorflowService,
  ) {}

  // ─── Content-Based Filtering ─────────────────────────────────────────────────

  /**
   * Find items similar to a target item using cosine similarity on feature tags.
   * @param targetTags  Tags/keywords describing the target item (e.g. product category, description)
   * @param allItems    Catalogue of { id, tags } objects
   * @param topN        How many to return (default 10)
   */
  getSimilarItems(
    targetTags: string,
    allItems: Array<{ id: string; tags: string }>,
    topN = 10,
  ): RecommendedItem[] {
    return allItems
      .map((item) => ({
        id: item.id,
        score: this.nlpService.similarity(targetTags, item.tags),
        reason: 'content similarity',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  /**
   * Recommend products to a user based on purchase history text descriptions.
   * @param purchasedTexts   Concatenated titles/descriptions of what the user bought
   * @param catalogueItems   Full product catalogue with text descriptions
   */
  getProductRecommendations(
    purchasedTexts: string,
    catalogueItems: Array<{ id: string; text: string }>,
    topN = 10,
  ): RecommendedItem[] {
    const safeText = Array.isArray(purchasedTexts)
      ? (purchasedTexts as string[]).join(' ')
      : String(purchasedTexts ?? '');
    const safeCatalogue = Array.isArray(catalogueItems) ? catalogueItems : [];
    if (!safeText) {
      // Cold start — return top-N by neutral score
      return safeCatalogue.slice(0, topN).map((i) => ({
        id: i.id,
        score: 0.5,
        reason: 'popular item',
      }));
    }

    return safeCatalogue
      .map((item) => ({
        id: item.id,
        score: this.nlpService.similarity(safeText, item.text),
        reason: 'purchase history match',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  // ─── Collaborative Filtering ─────────────────────────────────────────────────

  /**
   * User-based collaborative filtering.
   * Wraps AIInsightsService.collaborativeFilter for consistent usage.
   * @param targetVector  Interaction vector for the current user {itemId: count}
   * @param allVectors    Interaction vectors for all users {userId: {itemId: count}}
   */
  collaborativeRecommend(
    targetVector: Record<string, number>,
    allVectors: Record<string, Record<string, number>>,
    topN = 10,
  ): Array<{ id: string; score: number }> {
    const results = this.insightsService.collaborativeFilter(targetVector, allVectors, topN);
    return results.map((r) => ({ id: r.itemId, score: r.score }));
  }

  // ─── Personalised Feed ───────────────────────────────────────────────────────

  /**
   * Rank a feed of mixed-type content items for a specific user.
   * Uses NLP similarity between user interest text and content text.
   */
  getPersonalizedFeed(
    userInterestText: string,
    contentItems: Array<{ id: string; type: string; text: string }>,
    topN = 20,
  ): FeedItem[] {
    const safeText = Array.isArray(userInterestText)
      ? (userInterestText as string[]).join(' ')
      : String(userInterestText ?? '');
    const safeItems = Array.isArray(contentItems) ? contentItems : [];
    if (!safeText) {
      return safeItems.slice(0, topN).map((i) => ({
        id: i.id,
        type: i.type,
        score: 0.4,
        reason: 'default ranking',
      }));
    }

    return safeItems
      .map((item) => ({
        id: item.id,
        type: item.type,
        score: this.nlpService.similarity(safeText, item.text),
        reason: 'interest match',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  // ─── Blended Ranking ─────────────────────────────────────────────────────────

  /**
   * Blend collaborative and content-based recommendations.
   * Gives 60% weight to collaborative, 40% to content-based.
   * Returns de-duplicated, sorted list of item IDs.
   */
  blendRecommendations(
    collaborative: Array<{ id: string; score: number }>,
    contentBased: Array<{ id: string; score: number }>,
    topN = 10,
  ): Array<{ id: string; score: number; source: string }> {
    const scores = new Map<string, { score: number; sources: string[] }>();

    for (const item of collaborative) {
      const existing = scores.get(item.id) ?? { score: 0, sources: [] };
      existing.score += item.score * 0.6;
      existing.sources.push('collaborative');
      scores.set(item.id, existing);
    }

    for (const item of contentBased) {
      const existing = scores.get(item.id) ?? { score: 0, sources: [] };
      existing.score += item.score * 0.4;
      if (!existing.sources.includes('content')) existing.sources.push('content');
      scores.set(item.id, existing);
    }

    return Array.from(scores.entries())
      .map(([id, v]) => ({
        id,
        score: parseFloat(v.score.toFixed(4)),
        source: v.sources.join('+'),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  // ─── Subscription Plan Recommendation ────────────────────────────────────────

  /**
   * Recommend the most suitable subscription plan based on usage data.
   * @param monthlyUsageScore  Normalised usage score 0–1
   * @param currentTier        Current subscription tier name
   * @param plans              Available plans with feature scores
   */
  recommendSubscriptionPlan(
    monthlyUsageScore: number,
    currentTier: string,
    plans: Array<{ id: string; name: string; tier: string; featureScore: number; price: number }>,
  ): { planId: string; planName: string; reason: string; urgency: 'low' | 'medium' | 'high' } {
    // High usage + low tier → upgrade
    if (monthlyUsageScore > 0.8) {
      const upgrade = plans.find((p) => p.featureScore > 0.7 && p.tier !== currentTier);
      if (upgrade) {
        return {
          planId: upgrade.id,
          planName: upgrade.name,
          reason: "Your usage suggests you'd benefit from more features",
          urgency: 'high',
        };
      }
    }

    // Very low usage → downgrade suggestion
    if (monthlyUsageScore < 0.2) {
      const downgrade = plans.find((p) => p.featureScore < 0.4);
      if (downgrade) {
        return {
          planId: downgrade.id,
          planName: downgrade.name,
          reason: 'Optimise costs — a lighter plan matches your usage',
          urgency: 'low',
        };
      }
    }

    // Default — keep current
    const current = plans.find((p) => p.tier === currentTier) ?? plans[0];
    return {
      planId: current?.id ?? '',
      planName: current?.name ?? currentTier,
      reason: 'Your current plan is a good fit',
      urgency: 'low',
    };
  }

  // ─── Wishlist Conversion Scoring ──────────────────────────────────────────────

  /**
   * Score wishlist items by purchase likelihood.
   * High-priority + recent views + affordable price → higher score.
   */
  scoreWishlistConversion(
    items: Array<{
      id: string;
      name: string;
      priority: number; // 1-5, 1 = highest
      addedDaysAgo: number;
      estimatedPrice: number;
      budget?: number;
    }>,
  ): Array<{ id: string; conversionScore: number; suggestion: string }> {
    return items
      .map((item) => {
        let score = 0;

        // Priority weight: 1 = high → score 0.4, 5 = low → score 0.08
        score += ((6 - item.priority) / 5) * 0.4;

        // Recency weight: items added within 7 days score higher
        const recency = Math.max(0, 1 - item.addedDaysAgo / 30);
        score += recency * 0.3;

        // Affordability: within budget → +0.3
        if (item.budget && item.estimatedPrice <= item.budget) {
          score += 0.3;
        } else if (!item.budget) {
          score += 0.15; // neutral
        }

        score = parseFloat(Math.min(1, score).toFixed(3));

        const suggestion =
          score > 0.7
            ? 'High chance — consider buying now'
            : score > 0.4
              ? 'Moderate interest — monitor for price drops'
              : 'Low urgency — keep on wishlist';

        return { id: item.id, conversionScore: score, suggestion };
      })
      .sort((a, b) => b.conversionScore - a.conversionScore);
  }

  // ─── TF-Enhanced Item Relevance Ranking ──────────────────────────────────────

  /**
   * Rank a set of items against a user profile using the TF recommendations model.
   * Blends TF relevance (70%) with NLP tag similarity (30%) when TF is available.
   * Falls back to pure NLP when TF is disabled or the model is not loaded.
   *
   * User features (5, normalised 0-1):
   *   ageNorm, purchaseRate, avgSpendNorm, categoryDiversity, engagementScore
   * Item features (5, normalised 0-1):
   *   priceNorm, categoryScore, popularity, avgRating, recencyNorm
   */
  async rankItemsByRelevanceAsync(
    userFeatures: {
      ageNorm: number;          // age / 100
      purchaseRate: number;     // monthly purchases / 20 (capped 0-1)
      avgSpendNorm: number;     // avg monthly spend / 500 (capped 0-1)
      categoryDiversity: number; // distinct categories / 10 (capped 0-1)
      engagementScore: number;  // 0-1 direct
    },
    items: Array<{
      id: string;
      tags?: string;            // for NLP fallback
      priceNorm: number;        // item_price / max_price (0-1)
      categoryScore: number;    // 0-1
      popularity: number;       // normalised popularity 0-1
      avgRating: number;        // rating / 5 (0-1)
      recencyNorm: number;      // 1 - days_since_listed / 365 (0-1)
    }>,
    targetTags = '',
    topN = 10,
  ): Promise<Array<{ id: string; score: number; reason: string }>> {
    const userVec = [
      Math.min(Math.max(userFeatures.ageNorm, 0), 1),
      Math.min(Math.max(userFeatures.purchaseRate, 0), 1),
      Math.min(Math.max(userFeatures.avgSpendNorm, 0), 1),
      Math.min(Math.max(userFeatures.categoryDiversity, 0), 1),
      Math.min(Math.max(userFeatures.engagementScore, 0), 1),
    ];

    const tfAvailable = this.tfService.isEnabled() && this.tfService.hasModel('recommendations');

    const scored = await Promise.all(
      items.map(async (item) => {
        const itemVec = [
          Math.min(Math.max(item.priceNorm, 0), 1),
          Math.min(Math.max(item.categoryScore, 0), 1),
          Math.min(Math.max(item.popularity, 0), 1),
          Math.min(Math.max(item.avgRating, 0), 1),
          Math.min(Math.max(item.recencyNorm, 0), 1),
        ];

        let tfScore = 0.5; // neutral prior
        if (tfAvailable) {
          try {
            const result = await this.tfService.predict('recommendations', [[...userVec, ...itemVec]]);
            tfScore = result.values[0]?.[0] ?? 0.5;
          } catch (err) {
            this.logger.warn(`TF recommendations inference failed for item ${item.id}: ${err}`);
          }
        }

        const nlpScore = targetTags && item.tags
          ? this.nlpService.similarity(targetTags, item.tags)
          : 0.5;

        const blendedScore = tfAvailable
          ? parseFloat((0.7 * tfScore + 0.3 * nlpScore).toFixed(4))
          : parseFloat(nlpScore.toFixed(4));

        return {
          id: item.id,
          score: blendedScore,
          reason: tfAvailable ? '[TF+NLP] relevance' : 'content similarity',
        };
      }),
    );

    return scored.sort((a, b) => b.score - a.score).slice(0, topN);
  }
}
