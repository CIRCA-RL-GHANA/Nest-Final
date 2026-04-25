import { Injectable, Logger } from '@nestjs/common';
import { AITensorflowService } from './ai-tensorflow.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const natural = require('natural');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nlp = require('compromise');

export interface SentimentResult {
  score: number; // -1 (very negative) → +1 (very positive)
  label: 'positive' | 'neutral' | 'negative';
  confidence: number; // 0–1
  tokens: string[];
}

export interface IntentResult {
  intent: string;
  confidence: number;
  entities: Array<{ type: string; value: string }>;
  subIntent?: string;
}

export interface SearchScore {
  id: string;
  score: number;
  highlights: string[];
}

export interface TextSummary {
  summary: string;
  keywords: string[];
  wordCount: number;
  readingTimeSeconds: number;
}

/** Intent labels mapped to keyword sets */
const INTENT_PATTERNS: Record<string, string[]> = {
  buy: ['buy', 'purchase', 'order', 'get', 'shop', 'pay', 'checkout', 'add to cart'],
  sell: ['sell', 'list', 'post', 'upload', 'create listing'],
  ride: ['ride', 'trip', 'driver', 'pickup', 'dropoff', 'cab', 'taxi', 'transport'],
  search: ['search', 'find', 'look for', 'show me', 'where', 'what'],
  help: ['help', 'support', 'assistance', 'how do', 'guide', 'tutorial'],
  pricing: ['price', 'cost', 'how much', 'fee', 'rate', 'charge', 'discount', 'offer'],
  payment: ['pay', 'wallet', 'transfer', 'send money', 'topup', 'fund', 'payme'],
  social: ['chat', 'message', 'talk', 'connect', 'follow', 'share', 'comment'],
  schedule: ['book', 'schedule', 'appointment', 'calendar', 'remind', 'plan', 'event'],
  complaint: ['complaint', 'issue', 'problem', 'wrong', 'broken', 'fail', 'error', 'refund'],
  recommendation: ['recommend', 'suggest', 'what should', 'best', 'top', 'popular', 'trending'],
};

@Injectable()
export class AINlpService {
  private readonly logger = new Logger(AINlpService.name);
  private readonly tokenizer = new natural.WordTokenizer();
  private readonly stemmer = natural.PorterStemmer;
  private readonly analyzer = new natural.SentimentAnalyzer('English', this.stemmer, 'afinn');
  private tfidfEngine: any;

  /** Ordered class labels used by the NLU TF.js model (indices 0-11). */
  private static readonly NLU_CLASSES = [
    'buy', 'sell', 'ride', 'search', 'help', 'pricing',
    'payment', 'social', 'schedule', 'complaint', 'recommendation', 'unknown',
  ] as const;

  constructor(private readonly tfService: AITensorflowService) {
    this.tfidfEngine = new natural.TfIdf();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SENTIMENT
  // ─────────────────────────────────────────────────────────────────────────

  analyzeSentiment(text: string): SentimentResult {
    const tokens = this.tokenizer.tokenize(text.toLowerCase()) ?? [];
    const rawScore = this.analyzer.getSentiment(tokens);

    // rawScore is unbounded AFINN; normalise to [-1, 1]
    const clamped = Math.max(-1, Math.min(1, rawScore / 5));
    const label: SentimentResult['label'] =
      clamped > 0.15 ? 'positive' : clamped < -0.15 ? 'negative' : 'neutral';

    return {
      score: parseFloat(clamped.toFixed(4)),
      label,
      confidence: parseFloat(Math.min(1, Math.abs(clamped) + 0.3).toFixed(4)),
      tokens,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INTENT DETECTION
  // ─────────────────────────────────────────────────────────────────────────

  detectIntent(text: string): IntentResult {
    const lower = text.toLowerCase();
    const doc = nlp(text);

    // Score each intent
    const scores: Record<string, number> = {};
    for (const [intent, keywords] of Object.entries(INTENT_PATTERNS)) {
      scores[intent] = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const topIntent = sorted[0]?.[0] ?? 'unknown';
    const topScore = sorted[0]?.[1] ?? 0;
    const maxPossible = INTENT_PATTERNS[topIntent]?.length ?? 1;
    const confidence = parseFloat(Math.min(1, topScore / maxPossible + 0.1).toFixed(4));

    // Entity extraction via compromise
    const entities: IntentResult['entities'] = [];
    doc
      .people()
      .out('array')
      .forEach((v: string) => entities.push({ type: 'person', value: v }));
    doc
      .places()
      .out('array')
      .forEach((v: string) => entities.push({ type: 'place', value: v }));
    doc
      .values()
      .out('array')
      .forEach((v: string) => entities.push({ type: 'quantity', value: v }));
    doc
      .money()
      .out('array')
      .forEach((v: string) => entities.push({ type: 'money', value: v }));

    return {
      intent: topIntent,
      confidence,
      entities,
      subIntent:
        sorted[1]?.[0] !== topIntent && (sorted[1]?.[1] ?? 0) > 0 ? sorted[1]?.[0] : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NLU FEATURE VECTOR (used by TF.js NLU model)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Convert raw text to a 14-dimensional feature vector for the NLU TF.js model.
   *
   * Features 0-10 : normalised keyword match scores for each intent category
   *                 (same 11 categories as INTENT_PATTERNS, same order as NLU_CLASSES)
   * Feature 11    : is_question — has '?' or starts with interrogative word
   * Feature 12    : has_amount  — contains at least one digit
   * Feature 13    : is_negation — contains a negation word
   *
   * Public so that external callers (e.g. scripts, tests) can inspect the vector.
   */
  textToNluVector(text: string): number[] {
    const lower = text.toLowerCase();
    const intentKeys = Object.keys(INTENT_PATTERNS);
    const scores = intentKeys.map((intent) => {
      const keywords = INTENT_PATTERNS[intent];
      const matchCount = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
      return Math.min(1, matchCount / Math.max(1, keywords.length));
    });

    const isQuestion =
      lower.includes('?') || /^(how|what|where|when|why|who|which)\b/.test(lower) ? 1 : 0;
    const hasAmount = /\d/.test(lower) ? 1 : 0;
    const isNegation = /\b(no|not|don't|dont|can't|cant|never|without)\b/.test(lower) ? 1 : 0;

    return [...scores, isQuestion, hasAmount, isNegation]; // 14-D
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENHANCED INTENT DETECTION (uses NLU TF.js model when available)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Async intent detection that uses the NLU TF.js model when TF is enabled
   * and the 'nlu' model is loaded.  Falls back to keyword-based detectIntent()
   * when TF is disabled or the model is not present — zero breaking change for
   * existing synchronous callers.
   */
  async detectIntentEnhanced(text: string): Promise<IntentResult> {
    if (this.tfService.isEnabled() && this.tfService.hasModel('nlu')) {
      try {
        const vector = this.textToNluVector(text.toLowerCase().trim());
        const result = await this.tfService.predict('nlu', [vector]);

        if (result.values.length > 0) {
          const probs  = result.values[0]; // 12 class probabilities
          const topIdx = probs.indexOf(Math.max(...probs));
          const topProb = probs[topIdx] ?? 0;
          const classes = AINlpService.NLU_CLASSES;
          const topIntent = classes[topIdx] ?? 'unknown';

          // Extract entities the same way as the keyword path
          const doc      = nlp(text);
          const entities: IntentResult['entities'] = [];
          doc.people().out('array').forEach((v: string) => entities.push({ type: 'person', value: v }));
          doc.places().out('array').forEach((v: string) => entities.push({ type: 'place', value: v }));
          doc.values().out('array').forEach((v: string) => entities.push({ type: 'quantity', value: v }));
          doc.money().out('array').forEach((v: string) => entities.push({ type: 'money', value: v }));

          // Second-best class as subIntent (if its probability is non-trivial)
          const sortedProbs = [...probs].map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
          const second = sortedProbs[1];
          const subIntent =
            second && second.i !== topIdx && second.p > 0.1
              ? (classes[second.i] ?? undefined)
              : undefined;

          this.logger.debug(`NLU TF: "${topIntent}" (${(topProb * 100).toFixed(1)}%)`);

          return {
            intent: topIntent,
            confidence: parseFloat(Math.min(1, topProb).toFixed(4)),
            entities,
            subIntent,
          };
        }
      } catch (err: unknown) {
        this.logger.warn(
          `NLU TF prediction failed: ${err instanceof Error ? err.message : String(err)} — using keyword fallback`,
        );
      }
    }

    // Fallback: synchronous keyword-based detection
    return this.detectIntent(text);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // KEYWORD EXTRACTION
  // ─────────────────────────────────────────────────────────────────────────

  extractKeywords(text: string, topN = 10): string[] {
    const doc = nlp(text);
    const nouns = doc.nouns().out('array') as string[];
    const verbs = doc.verbs().toInfinitive().out('array') as string[];
    const terms = [...new Set([...nouns, ...verbs])];
    const stopWords = new Set([
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'shall',
      'can',
      'the',
      'a',
      'an',
      'this',
      'that',
      'these',
      'those',
      'it',
      'its',
      'they',
      'them',
      'their',
      'we',
      'our',
      'you',
      'your',
    ]);
    const filtered = terms.filter((t) => t.length > 2 && !stopWords.has(t.toLowerCase()));
    return filtered.slice(0, topN);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TF-IDF SEARCH RANKING
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add a document to the TF-IDF engine.
   * Call this for each indexable item (products, posts, etc.).
   */
  indexDocument(id: string, text: string): void {
    this.tfidfEngine.addDocument(text, id);
  }

  /** Reset the TF-IDF index (e.g. before re-indexing all products). */
  resetIndex(): void {
    this.tfidfEngine = new natural.TfIdf();
  }

  /**
   * Score a query against all indexed documents.
   * Returns top results sorted by relevance.
   */
  searchDocuments(query: string, topN = 20): SearchScore[] {
    const queryTokens = this.tokenizer.tokenize(query.toLowerCase()) ?? [];
    const results: SearchScore[] = [];

    this.tfidfEngine.tfidfs(queryTokens.join(' '), (i: number, measure: number) => {
      if (measure > 0) {
        results.push({ id: String(i), score: measure, highlights: queryTokens });
      }
    });

    return results.sort((a, b) => b.score - a.score).slice(0, topN);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BASIC SUMMARISATION
  // ─────────────────────────────────────────────────────────────────────────

  summariseText(text: string): TextSummary {
    // Guard against excessively long inputs to prevent ReDoS
    const safeText = typeof text === 'string' ? text.slice(0, 10_000) : String(text ?? '');
    const sentences = safeText.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    const sentenceList = sentences.length > 0 ? sentences : [safeText];
    const keywords = this.extractKeywords(safeText, 8);
    const wordCount = (safeText.match(/\b\w+\b/g) ?? []).length;
    // Rank sentences by keyword overlap
    const ranked = sentenceList
      .map((s) => ({
        s,
        score: keywords.filter((k) => s.toLowerCase().includes(k.toLowerCase())).length,
      }))
      .sort((a, b) => b.score - a.score);
    const summaryLines = ranked.slice(0, Math.min(3, Math.ceil(sentenceList.length / 4)));
    const summary = summaryLines.map((r) => r.s.trim()).join(' ');

    return {
      summary,
      keywords,
      wordCount,
      readingTimeSeconds: Math.round((wordCount / 200) * 60),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SIMILARITY (cosine)
  // ─────────────────────────────────────────────────────────────────────────

  /** Cosine similarity between two texts (0–1). */
  similarity(text1: string, text2: string): number {
    const t1 = this.tokenize(text1);
    const t2 = this.tokenize(text2);
    const vocab = new Set([...t1, ...t2]);
    const vec1 = Array.from(vocab).map((w) => t1.filter((t) => t === w).length);
    const vec2 = Array.from(vocab).map((w) => t2.filter((t) => t === w).length);
    const dot = vec1.reduce((s, v, i) => s + v * vec2[i], 0);
    const mag1 = Math.sqrt(vec1.reduce((s, v) => s + v * v, 0));
    const mag2 = Math.sqrt(vec2.reduce((s, v) => s + v * v, 0));
    if (mag1 === 0 || mag2 === 0) return 0;
    return parseFloat((dot / (mag1 * mag2)).toFixed(4));
  }

  private tokenize(text: string): string[] {
    return (this.tokenizer.tokenize(text.toLowerCase()) ?? []).map((t: string) =>
      this.stemmer.stem(t),
    );
  }
}
