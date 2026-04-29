import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { createClient } from 'redis';
import { FacilitatorAccount } from '../entities/facilitator-account.entity';
import { FacilitatorProvider } from './payment-facilitator.service';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface FacilitatorCashBalance {
  /** Which facilitator this balance comes from. */
  facilitatorId: FacilitatorProvider;
  /**
   * Platform's available fiat balance at this facilitator in USD-equivalent.
   * null when the provider does not support a balance inquiry API.
   */
  cashBalanceUsd: number | null;
  /** Original currency returned by the provider (may differ from USD). */
  displayCurrency: string;
  /** Human-readable explanation of the 0.1% liquidity fee. */
  feeDescription: string;
  /** Current buy price: $1.001 per Q Point (includes 0.1% liquidity fee). */
  buyPrice: number;
  /** Current sell price: $0.999 per Q Point (net of 0.1% liquidity fee). */
  sellPrice: number;
  /** Liquidity fee as a percentage (0.1). */
  liquidityFeePercent: number;
  /** ISO 8601 timestamp of when this data was fetched or read from cache. */
  lastUpdatedAt: string;
  /** True when this result was served from the 30-second Redis cache. */
  isCached: boolean;
  /** False when the provider does not expose a balance inquiry API. */
  isAvailable: boolean;
  /** Explains why `isAvailable` is false. Only present when isAvailable=false. */
  unavailableReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 30;
const BUY_PRICE = 1.001;
const SELL_PRICE = 0.999;
const LIQUIDITY_FEE_PCT = 0.1;
const FEE_DESCRIPTION =
  '0.1% liquidity fee covers cross-facilitator payment processing. ' +
  'Buy: $1.001/QP · Sell: $0.999/QP (both sides reflect the same fee).';

const cacheKey = (userId: string, provider: FacilitatorProvider) =>
  `fbal:${userId}:${provider}`;

const ALL_PROVIDERS: FacilitatorProvider[] = [
  'mock', 'flutterwave', 'paystack', 'mtn_momo', 'mpesa', 'wise', 'stripe',
];

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FacilitatorBalanceService
 *
 * Fetches the platform's real-time cash balance at each payment facilitator
 * via server-to-server API calls and caches results in Redis for 30 seconds.
 *
 * Architecture rules:
 *  - NEVER called from the client directly — always server-to-server.
 *  - Cache reads: O(1) Redis GET with 30s TTL.
 *  - Cache writes: non-fatal — balance still returned on Redis failure.
 *  - Webhooks call `invalidateCache()` to push freshness on facilitator events.
 *  - The balance represents the platform's available liquidity at the
 *    facilitator, confirming that cash-out is possible for the user.
 */
@Injectable()
export class FacilitatorBalanceService {
  private readonly logger = new Logger(FacilitatorBalanceService.name);

  // Redis client — lazily connected, null when unavailable
  private redis: ReturnType<typeof createClient> | null = null;
  private redisConnecting = false;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(FacilitatorAccount)
    private readonly facilitatorAccountRepo: Repository<FacilitatorAccount>,
  ) {}

  // =========================================================================
  // Redis helpers
  // =========================================================================

  private async getRedis(): Promise<ReturnType<typeof createClient> | null> {
    if (this.redis?.isReady) return this.redis;
    if (this.redisConnecting) return null;

    try {
      this.redisConnecting = true;
      const host = this.config.get<string>('redis.host') ?? 'localhost';
      const port = this.config.get<number>('redis.port') ?? 6379;
      const password = this.config.get<string>('redis.password');
      const db = this.config.get<number>('redis.db') ?? 0;

      const client = createClient({
        socket: { host, port, connectTimeout: 3000 },
        password: password || undefined,
        database: db,
      });

      client.on('error', (err: Error) =>
        this.logger.warn(`Redis error: ${err.message}`),
      );
      await client.connect();
      this.redis = client;
      this.logger.log('FacilitatorBalanceService connected to Redis');
    } catch (err: any) {
      this.logger.warn(
        `Redis unavailable — balance cache disabled: ${err.message}`,
      );
      this.redis = null;
    } finally {
      this.redisConnecting = false;
    }

    return this.redis;
  }

  private async readCache(key: string): Promise<FacilitatorCashBalance | null> {
    const r = await this.getRedis();
    if (!r) return null;
    try {
      const raw = await r.get(key);
      return raw ? (JSON.parse(raw) as FacilitatorCashBalance) : null;
    } catch {
      return null;
    }
  }

  private async writeCache(
    key: string,
    value: FacilitatorCashBalance,
  ): Promise<void> {
    const r = await this.getRedis();
    if (!r) return;
    try {
      await r.set(key, JSON.stringify(value), { EX: CACHE_TTL_SECONDS });
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Invalidate the cached balance for a user.
   * Called by webhook handlers when a facilitator notifies the platform of a
   * balance change (e.g. a completed transfer, deposit, or reconciliation).
   *
   * @param userId   Internal platform user ID
   * @param provider Specific facilitator to invalidate; omit to clear all.
   */
  async invalidateCache(
    userId: string,
    provider?: FacilitatorProvider,
  ): Promise<void> {
    const r = await this.getRedis();
    if (!r) return;
    try {
      const keys = provider
        ? [cacheKey(userId, provider)]
        : ALL_PROVIDERS.map((p) => cacheKey(userId, p));
      await Promise.all(keys.map((k) => r.del(k)));
    } catch {
      /* non-fatal */
    }
  }

  // =========================================================================
  // Main entry point
  // =========================================================================

  /**
   * Get the platform's available cash balance at the user's primary registered
   * facilitator.
   *
   * @param userId       Internal platform user ID.
   * @param forceRefresh When true, bypasses the 30-second Redis cache and
   *                     fetches directly from the facilitator API.
   */
  async getBalance(
    userId: string,
    forceRefresh = false,
  ): Promise<FacilitatorCashBalance> {
    // Resolve user's primary facilitator account (oldest registration wins)
    const accounts = await this.facilitatorAccountRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });

    if (accounts.length === 0) {
      return this._unavailable(
        'mock',
        'No payment account registered. Complete onboarding at POST /api/v1/qpoints/payment/register.',
      );
    }

    const primary = accounts[0];
    const provider = primary.provider;
    const key = cacheKey(userId, provider);

    // Serve from cache unless force-refresh requested
    if (!forceRefresh) {
      const cached = await this.readCache(key);
      if (cached) return { ...cached, isCached: true };
    }

    // Fetch fresh balance from the facilitator API
    const fresh = await this._fetchFromProvider(provider, primary.externalId);
    await this.writeCache(key, fresh);
    return fresh;
  }

  // =========================================================================
  // Provider dispatch
  // =========================================================================

  private async _fetchFromProvider(
    provider: FacilitatorProvider,
    externalId: string,
  ): Promise<FacilitatorCashBalance> {
    try {
      switch (provider) {
        case 'mock':       return this._fetchMock();
        case 'paystack':   return this._fetchPaystack();
        case 'flutterwave':return this._fetchFlutterwave();
        case 'stripe':     return this._fetchStripe(externalId);
        case 'wise':       return this._fetchWise();
        case 'mtn_momo':   return this._fetchMtnMomo();
        case 'mpesa':      return this._fetchMpesa();
        default:
          return this._unavailable(
            provider,
            `Balance inquiry not supported for provider: ${provider}`,
          );
      }
    } catch (err: any) {
      this.logger.warn(
        `Balance fetch failed for ${provider}: ${err.message}`,
      );
      return this._unavailable(
        provider,
        'Balance temporarily unavailable. Please try again later.',
      );
    }
  }

  // =========================================================================
  // Provider-specific implementations
  // =========================================================================

  /** Mock provider — deterministic base + small random jitter for realism. */
  private _fetchMock(): FacilitatorCashBalance {
    const base = 1_500.0;
    const jitter = Math.round((Math.random() * 20 - 10) * 100) / 100;
    return this._ok('mock', parseFloat((base + jitter).toFixed(2)));
  }

  /**
   * Paystack — returns the platform's Paystack ledger balance.
   * Endpoint: GET https://api.paystack.co/balance
   * Docs: https://paystack.com/docs/api/balance/
   */
  private async _fetchPaystack(): Promise<FacilitatorCashBalance> {
    const key = this.config.get<string>('payments.paystack.secretKey');
    if (!key) {
      return this._unavailable('paystack', 'Paystack credentials not configured.');
    }

    const res = await axios.get<{
      status: boolean;
      data: { currency: string; balance: number }[];
    }>('https://api.paystack.co/balance', {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 8_000,
    });

    const entries = res.data?.data ?? [];
    // Prefer USD; fall back to first currency returned
    const entry =
      entries.find((b) => b.currency === 'USD') ??
      entries[0];

    if (!entry) {
      return this._unavailable('paystack', 'No balance data returned from Paystack.');
    }

    // Paystack returns smallest unit (kobo for NGN, cents for USD)
    const amountUsd = entry.balance / 100;
    return this._ok('paystack', amountUsd, entry.currency);
  }

  /**
   * Flutterwave — returns the platform's USD ledger balance.
   * Endpoint: GET https://api.flutterwave.com/v3/balances/USD
   * Docs: https://developer.flutterwave.com/reference/endpoints/balances/
   */
  private async _fetchFlutterwave(): Promise<FacilitatorCashBalance> {
    const key = this.config.get<string>('payments.flutterwave.secretKey');
    if (!key) {
      return this._unavailable('flutterwave', 'Flutterwave credentials not configured.');
    }

    const res = await axios.get<{
      status: string;
      data: { currency: string; available_balance: number; ledger_balance: number };
    }>('https://api.flutterwave.com/v3/balances/USD', {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 8_000,
    });

    const data = res.data?.data;
    if (!data) {
      return this._unavailable('flutterwave', 'No balance data returned from Flutterwave.');
    }

    return this._ok('flutterwave', data.available_balance, data.currency ?? 'USD');
  }

  /**
   * Stripe — fetches balance for the platform account or a connected account.
   * Endpoint: GET https://api.stripe.com/v1/balance
   * Docs: https://stripe.com/docs/api/balance/retrieve
   *
   * When externalId starts with "acct_" (Stripe Connect), the balance of that
   * connected account is returned via the Stripe-Account header.
   */
  private async _fetchStripe(
    externalId: string,
  ): Promise<FacilitatorCashBalance> {
    const key = this.config.get<string>('payments.stripe.secretKey');
    if (!key) {
      return this._unavailable('stripe', 'Stripe credentials not configured.');
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
    };
    if (externalId.startsWith('acct_')) {
      headers['Stripe-Account'] = externalId;
    }

    const res = await axios.get<{
      available: { amount: number; currency: string }[];
    }>('https://api.stripe.com/v1/balance', { headers, timeout: 8_000 });

    const available = res.data?.available ?? [];
    const usd =
      available.find((b) => b.currency === 'usd') ?? available[0];

    if (!usd) {
      return this._unavailable('stripe', 'No balance data returned from Stripe.');
    }

    // Stripe returns amounts in the smallest currency unit (cents for USD)
    return this._ok('stripe', usd.amount / 100, 'USD');
  }

  /**
   * Wise — fetches platform STANDARD balance for USD.
   * Endpoint: GET https://api.wise.com/v4/profiles/{profileId}/balances?types=STANDARD
   * Docs: https://docs.wise.com/api-docs/api-reference/balance
   */
  private async _fetchWise(): Promise<FacilitatorCashBalance> {
    const key = this.config.get<string>('payments.wise.apiKey');
    if (!key) {
      return this._unavailable('wise', 'Wise credentials not configured.');
    }

    const authHeader = { Authorization: `Bearer ${key}` };

    // Step 1: resolve the business profile ID
    const profileRes = await axios.get<{ id: number; type: string }[]>(
      'https://api.wise.com/v1/profiles',
      { headers: authHeader, timeout: 8_000 },
    );
    const profile =
      profileRes.data?.find((p) => p.type === 'business') ??
      profileRes.data?.[0];

    if (!profile) {
      return this._unavailable('wise', 'No Wise profile found.');
    }

    // Step 2: fetch balances
    const balRes = await axios.get<{
      currency: string;
      amount: { value: number; currency: string };
      type: string;
    }[]>(
      `https://api.wise.com/v4/profiles/${profile.id}/balances?types=STANDARD`,
      { headers: authHeader, timeout: 8_000 },
    );

    const usd = balRes.data?.find((b) => b.amount?.currency === 'USD');
    if (!usd) {
      return this._unavailable('wise', 'No USD balance found on Wise account.');
    }

    return this._ok('wise', usd.amount?.value ?? 0, usd.amount?.currency ?? 'USD');
  }

  /**
   * MTN MoMo — fetches the platform collection account balance.
   * Endpoint: GET /collection/v1_0/account/balance
   * Docs: https://momodeveloper.mtn.com/api-documentation/api-description
   */
  private async _fetchMtnMomo(): Promise<FacilitatorCashBalance> {
    const apiKey = this.config.get<string>('payments.mtnMomo.apiKey');
    const momoUserId = this.config.get<string>('payments.mtnMomo.userId');
    const baseUrl =
      this.config.get<string>('payments.mtnMomo.baseUrl') ??
      'https://sandbox.momodeveloper.mtn.com';

    if (!apiKey || !momoUserId) {
      return this._unavailable(
        'mtn_momo',
        'MTN MoMo credentials not configured for balance inquiry.',
      );
    }

    // Step 1: obtain access token via Basic auth
    const tokenRes = await axios.post<{ access_token: string }>(
      `${baseUrl}/collection/token/`,
      {},
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${momoUserId}:${apiKey}`).toString('base64')}`,
          'Ocp-Apim-Subscription-Key': apiKey,
        },
        timeout: 8_000,
      },
    );

    const token = tokenRes.data?.access_token;
    if (!token) {
      return this._unavailable('mtn_momo', 'MTN MoMo token exchange failed.');
    }

    // Step 2: fetch account balance
    const balRes = await axios.get<{
      availableBalance: string;
      currency: string;
    }>(`${baseUrl}/collection/v1_0/account/balance`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': apiKey,
        'X-Target-Environment':
          baseUrl.includes('sandbox') ? 'sandbox' : 'mtncongo',
      },
      timeout: 8_000,
    });

    const balance = parseFloat(balRes.data?.availableBalance ?? '0');
    const currency = balRes.data?.currency ?? 'GHS';
    return this._ok('mtn_momo', balance, currency);
  }

  /**
   * M-Pesa — balance inquiry requires Daraja Account Balance API (B2B/Paybill only).
   * This is an async callback API; a synchronous implementation is non-trivial.
   * Returns unavailable for now with a clear message.
   */
  private _fetchMpesa(): FacilitatorCashBalance {
    return this._unavailable(
      'mpesa',
      'M-Pesa balance inquiry uses an async callback flow. ' +
        'Balance updates are delivered via webhook. Please check your M-Pesa app for the current balance.',
    );
  }

  // =========================================================================
  // Result builders
  // =========================================================================

  private _ok(
    provider: FacilitatorProvider,
    cashBalanceUsd: number,
    displayCurrency = 'USD',
  ): FacilitatorCashBalance {
    return {
      facilitatorId: provider,
      cashBalanceUsd,
      displayCurrency,
      feeDescription: FEE_DESCRIPTION,
      buyPrice: BUY_PRICE,
      sellPrice: SELL_PRICE,
      liquidityFeePercent: LIQUIDITY_FEE_PCT,
      lastUpdatedAt: new Date().toISOString(),
      isCached: false,
      isAvailable: true,
    };
  }

  private _unavailable(
    provider: FacilitatorProvider,
    reason: string,
  ): FacilitatorCashBalance {
    return {
      facilitatorId: provider,
      cashBalanceUsd: null,
      displayCurrency: 'USD',
      feeDescription: FEE_DESCRIPTION,
      buyPrice: BUY_PRICE,
      sellPrice: SELL_PRICE,
      liquidityFeePercent: LIQUIDITY_FEE_PCT,
      lastUpdatedAt: new Date().toISOString(),
      isCached: false,
      isAvailable: false,
      unavailableReason: reason,
    };
  }
}
