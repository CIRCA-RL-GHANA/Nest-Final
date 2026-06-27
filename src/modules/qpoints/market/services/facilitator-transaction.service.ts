import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  FacilitatorTransaction,
  FacilitatorTransactionType,
  FacilitatorTransactionStatus,
} from '../entities/facilitator-transaction.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { FacilitatorAccount } from '../entities/facilitator-account.entity';
import { PaymentFacilitatorService } from './payment-facilitator.service';
import { FacilitatorBalanceService } from './facilitator-balance.service';
import { FacilitatorProvider } from './payment-facilitator.service';
import { MarketBalanceService } from './market-balance.service';

// ─────────────────────────────────────────────────────────────────────────────
// Return types
// ─────────────────────────────────────────────────────────────────────────────

export interface DepositResult {
  /** Internal platform transaction ID — store on client for status polling. */
  transactionId: string;
  provider: FacilitatorProvider;
  /**
   * Hosted checkout page URL.  The frontend opens this in the system browser.
   * null for providers that push the prompt to the user's device (MTN MoMo, M-Pesa).
   */
  checkoutUrl: string | null;
  /**
   * Stripe PaymentIntent client_secret for native Stripe.js / mobile SDK use.
   * null for redirect-based providers.
   */
  clientSecret: string | null;
  /** Provider-issued session / reference ID. */
  externalId: string;
}

export interface WithdrawalResult {
  /** Internal platform transaction ID. */
  transactionId: string;
  provider: FacilitatorProvider;
  /** Provider-issued payout / transfer ID. */
  externalId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FacilitatorTransactionService
 *
 * Orchestrates user-initiated deposits (on-ramp) and withdrawals (off-ramp)
 * across all supported payment facilitators.
 *
 * The platform NEVER holds user funds.  This service:
 *   1. Validates daily limits and provider requirements.
 *   2. Creates a PENDING transaction record (idempotent).
 *   3. Calls the provider API to initiate the payment session / payout.
 *   4. Returns a checkout URL or payout ID to the controller.
 *   5. Processes incoming webhook events (idempotent) to update final status.
 *   6. Busts the cached balance (FacilitatorBalanceService.invalidateCache)
 *      so the UI reflects the new balance immediately after completion.
 *
 * Security:
 *   - Stripe webhooks: verified via HMAC-SHA256 (Stripe-Signature header).
 *   - Paystack webhooks: verified via HMAC-SHA512 (X-Paystack-Signature header).
 *   - Flutterwave webhooks: verified via X-Flutterwave-Signature secret hash.
 *   - All handlers are idempotent: webhook_events table prevents double-processing.
 */
@Injectable()
export class FacilitatorTransactionService {
  private readonly logger = new Logger(FacilitatorTransactionService.name);

  private readonly DAILY_DEPOSIT_LIMIT: number;
  private readonly DAILY_WITHDRAW_LIMIT: number;
  private readonly MIN_DEPOSIT: number;
  private readonly MIN_WITHDRAW: number;

  constructor(
    @InjectRepository(FacilitatorTransaction)
    private readonly txRepo: Repository<FacilitatorTransaction>,
    @InjectRepository(WebhookEvent)
    private readonly webhookRepo: Repository<WebhookEvent>,
    @InjectRepository(FacilitatorAccount)
    private readonly accountRepo: Repository<FacilitatorAccount>,
    private readonly facilitator: PaymentFacilitatorService,
    private readonly balanceCache: FacilitatorBalanceService,
    private readonly marketBalance: MarketBalanceService,
    private readonly config: ConfigService,
  ) {
    this.DAILY_DEPOSIT_LIMIT = this.config.get<number>('payments.dailyDepositLimit') ?? 10_000;
    this.DAILY_WITHDRAW_LIMIT = this.config.get<number>('payments.dailyWithdrawLimit') ?? 5_000;
    this.MIN_DEPOSIT = this.config.get<number>('payments.minDepositAmount') ?? 1;
    this.MIN_WITHDRAW = this.config.get<number>('payments.minWithdrawAmount') ?? 5;
  }

  // =========================================================================
  // Deposit (On-Ramp)
  // =========================================================================

  /**
   * Initiates a deposit into the user's facilitator account.
   *
   * Returns a checkoutUrl (redirect-based providers) or clientSecret
   * (Stripe PaymentIntent) for the frontend to complete the payment.
   * For push-based providers (MTN MoMo, M-Pesa) the prompt goes to the
   * user's phone — no URL is returned.
   */
  async createDeposit(
    userId: string,
    amount: number,
    currency = 'USD',
  ): Promise<DepositResult> {
    if (amount < this.MIN_DEPOSIT) {
      throw new BadRequestException(
        `Minimum deposit is $${this.MIN_DEPOSIT.toFixed(2)}.`,
      );
    }

    await this._checkDailyLimit(userId, FacilitatorTransactionType.DEPOSIT, amount);

    const account = await this._resolveAccount(userId);
    const idempotencyKey = `deposit:${userId}:${uuidv4()}`;

    // Create PENDING record before calling provider (prevents double creation on retry)
    const tx = this.txRepo.create({
      userId,
      provider: account.provider,
      type: FacilitatorTransactionType.DEPOSIT,
      amount,
      currency: currency.toUpperCase(),
      status: FacilitatorTransactionStatus.PENDING,
      idempotencyKey,
    });
    await this.txRepo.save(tx);

    try {
      const result = await this.facilitator.createDepositSession(
        userId,
        account.externalId,
        amount,
        currency,
        account.provider,
        idempotencyKey,
      );

      tx.externalId = result.externalId;
      tx.checkoutUrl = result.checkoutUrl ?? undefined;
      tx.status = FacilitatorTransactionStatus.PROCESSING;
      await this.txRepo.save(tx);

      return {
        transactionId: tx.id,
        provider: account.provider,
        checkoutUrl: result.checkoutUrl,
        clientSecret: result.clientSecret,
        externalId: result.externalId,
      };
    } catch (err: any) {
      tx.status = FacilitatorTransactionStatus.FAILED;
      tx.errorMessage = err.message ?? 'Facilitator API error';
      await this.txRepo.save(tx);
      // Re-throw as BadRequestException so the controller returns 400
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Deposit initiation failed: ${tx.errorMessage}`);
    }
  }

  // =========================================================================
  // Withdrawal (Off-Ramp)
  // =========================================================================

  /**
   * Initiates a payout from the user's facilitator account to their bank.
   *
   * The facilitator processes the payout asynchronously — final status is
   * delivered via webhook.  The transaction record starts as PROCESSING and
   * transitions to COMPLETED or FAILED on webhook receipt.
   */
  async createWithdrawal(
    userId: string,
    amount: number,
    currency = 'USD',
    payoutMethodId?: string,
  ): Promise<WithdrawalResult> {
    if (amount < this.MIN_WITHDRAW) {
      throw new BadRequestException(
        `Minimum withdrawal is $${this.MIN_WITHDRAW.toFixed(2)}.`,
      );
    }

    await this._checkDailyLimit(userId, FacilitatorTransactionType.WITHDRAW, amount);

    const account = await this._resolveAccount(userId);

    const resolvedPayoutMethodId =
      payoutMethodId ??
      (account as any).defaultPayoutMethodId ??
      account.externalId;

    if (!resolvedPayoutMethodId) {
      throw new BadRequestException(
        'No payout method found. Provide a payoutMethodId or register a default payment account.',
      );
    }

    const idempotencyKey = `withdraw:${userId}:${uuidv4()}`;

    const tx = this.txRepo.create({
      userId,
      provider: account.provider,
      type: FacilitatorTransactionType.WITHDRAW,
      amount,
      currency: currency.toUpperCase(),
      status: FacilitatorTransactionStatus.PENDING,
      idempotencyKey,
    });
    await this.txRepo.save(tx);

    try {
      const result = await this.facilitator.createWithdrawalPayout(
        userId,
        account.externalId,
        amount,
        currency,
        account.provider,
        resolvedPayoutMethodId,
        idempotencyKey,
      );

      tx.externalId = result.externalId;
      tx.status = FacilitatorTransactionStatus.PROCESSING;
      await this.txRepo.save(tx);

      return {
        transactionId: tx.id,
        provider: account.provider,
        externalId: result.externalId,
      };
    } catch (err: any) {
      tx.status = FacilitatorTransactionStatus.FAILED;
      tx.errorMessage = err.message ?? 'Facilitator API error';
      await this.txRepo.save(tx);
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Withdrawal initiation failed: ${tx.errorMessage}`);
    }
  }

  // =========================================================================
  // Transaction listing
  // =========================================================================

  async getUserTransactions(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ items: FacilitatorTransaction[]; total: number }> {
    const [items, total] = await this.txRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 100),
      skip: offset,
    });
    return { items, total };
  }

  async getTransaction(id: string, userId: string): Promise<FacilitatorTransaction> {
    const tx = await this.txRepo.findOne({ where: { id, userId } });
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  // =========================================================================
  // Webhook handlers — all idempotent
  // =========================================================================

  /**
   * Stripe webhook handler.
   *
   * Verifies the Stripe-Signature header using HMAC-SHA256 before processing.
   * Handles: payment_intent.succeeded, payment_intent.payment_failed,
   *          checkout.session.completed, payout.paid, payout.failed
   */
  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const secret = this.config.get<string>('payments.stripe.webhookSecret');
    if (!secret) {
      this.logger.warn('STRIPE_WEBHOOK_SECRET not configured — ignoring event');
      return;
    }

    // Verify signature manually (HMAC-SHA256, same as Stripe SDK)
    const payload = rawBody.toString('utf8');
    const parts = signature.split(',').reduce(
      (acc: Record<string, string>, part) => {
        const [k, v] = part.split('=');
        if (k && v) acc[k] = v;
        return acc;
      },
      {},
    );
    const { t: timestamp, v1: v1Sig } = parts;

    if (!timestamp || !v1Sig) {
      this.logger.warn('Stripe webhook: malformed Stripe-Signature header');
      return;
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    const sigBuf = Buffer.from(v1Sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      this.logger.warn('Stripe webhook: signature mismatch — rejecting');
      return;
    }

    let event: any;
    try {
      event = JSON.parse(payload);
    } catch {
      this.logger.warn('Stripe webhook: failed to parse payload');
      return;
    }

    const eventId = `stripe:${event.id as string}`;
    if (await this._isProcessed(eventId)) return;

    const obj = event.data?.object;
    try {
      switch (event.type as string) {
        case 'checkout.session.completed':
          if (obj.payment_status === 'paid') {
            await this._completeDeposit(
              obj.client_reference_id ?? obj.id,
              (obj.amount_total ?? 0) / 100,
            );
          }
          break;
        case 'payment_intent.succeeded':
          await this._completeDeposit(obj.id, (obj.amount ?? 0) / 100);
          break;
        case 'payment_intent.payment_failed':
          await this._failTransaction(
            obj.id,
            obj.last_payment_error?.message ?? 'Payment failed',
          );
          break;
        case 'payout.paid':
          await this._completeWithdrawal(obj.id);
          break;
        case 'payout.failed':
          await this._failTransaction(obj.id, obj.failure_message ?? 'Payout failed');
          break;
        default:
          break; // ack & ignore unhandled event types
      }
      await this._recordProcessed(eventId, 'stripe', event.type, event);
    } catch (err: any) {
      this.logger.error(`Stripe webhook processing error: ${err.message}`, err.stack);
      // Do not rethrow — must return 2xx to prevent Stripe retry storm
    }
  }

  /**
   * Paystack webhook handler.
   * Verifies X-Paystack-Signature (HMAC-SHA512 of raw body with secret key).
   */
  async handlePaystackWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    const secret = this.config.get<string>('payments.paystack.secretKey');
    if (!secret) return;

    const expected = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      this.logger.warn('Paystack webhook: signature mismatch');
      return;
    }

    let body: any;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return;
    }

    const eventId = `paystack:${body.data?.id ?? body.event}:${body.data?.reference ?? ''}`;
    if (await this._isProcessed(eventId)) return;

    try {
      switch (body.event as string) {
        case 'charge.success':
          await this._completeDeposit(
            body.data?.reference,
            (body.data?.amount ?? 0) / 100,
          );
          break;
        case 'transfer.success':
          await this._completeWithdrawal(body.data?.transfer_code);
          break;
        case 'transfer.failed':
        case 'transfer.reversed':
          await this._failTransaction(
            body.data?.transfer_code,
            body.data?.status ?? 'Transfer failed',
          );
          break;
        default:
          break;
      }
      await this._recordProcessed(eventId, 'paystack', body.event, body);
    } catch (err: any) {
      this.logger.error(`Paystack webhook error: ${err.message}`);
    }
  }

  /**
   * Flutterwave webhook handler.
   * Verifies the verif-hash header against FLW_WEBHOOK_HASH env var.
   */
  async handleFlutterwaveWebhook(
    body: Record<string, any>,
    secretHash: string,
  ): Promise<void> {
    const expectedHash = this.config.get<string>('payments.flutterwave.webhookHash');
    if (!expectedHash) {
      this.logger.warn('Flutterwave webhook: FLUTTERWAVE_WEBHOOK_HASH not configured — rejecting request');
      return;
    }
    const expected = Buffer.from(expectedHash);
    const received = Buffer.from(secretHash ?? '');
    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
      this.logger.warn('Flutterwave webhook: hash mismatch — rejecting');
      return;
    }

    const txRef = body.data?.tx_ref ?? String(body.data?.id ?? '');
    const eventId = `flw:${txRef}:${body.event}`;
    if (!txRef || await this._isProcessed(eventId)) return;

    try {
      if (body.event === 'charge.completed' && body.data?.status === 'successful') {
        await this._completeDeposit(txRef, body.data?.amount ?? 0);
      } else if (body.event === 'transfer.completed' && body.data?.status === 'SUCCESSFUL') {
        await this._completeWithdrawal(String(body.data?.id));
      } else if (body.event === 'transfer.completed' && body.data?.status === 'FAILED') {
        await this._failTransaction(String(body.data?.id), 'Transfer failed');
      }
      await this._recordProcessed(eventId, 'flutterwave', body.event as string, body);
    } catch (err: any) {
      this.logger.error(`Flutterwave webhook error: ${err.message}`);
    }
  }

  /**
   * MTN MoMo webhook handler (no standard signature — verify with shared secret).
   */
  async handleMtnMomoWebhook(
    body: Record<string, any>,
    secret?: string,
  ): Promise<void> {
    const expectedSecret = this.config.get<string>('payments.mtnMomo.webhookSecret');
    if (!expectedSecret) {
      this.logger.warn('MTN MoMo webhook: MTN_MOMO_WEBHOOK_SECRET not configured — rejecting request');
      return;
    }
    const expBuf = Buffer.from(expectedSecret);
    const recBuf = Buffer.from(secret ?? '');
    if (expBuf.length !== recBuf.length || !crypto.timingSafeEqual(expBuf, recBuf)) {
      this.logger.warn('MTN MoMo webhook: secret mismatch — rejecting');
      return;
    }

    const ref = body.referenceId ?? body.externalId ?? '';
    const eventId = `momo:${ref}:${body.type ?? body.status}`;
    if (!ref || await this._isProcessed(eventId)) return;

    try {
      const status = (body.status ?? '').toUpperCase();
      if (status === 'SUCCESSFUL') {
        const isCollection = ['COLLECTION', 'DEPOSIT'].includes(
          (body.type ?? '').toUpperCase(),
        );
        if (isCollection) {
          await this._completeDeposit(ref, parseFloat(body.amount ?? '0'));
        } else {
          await this._completeWithdrawal(ref);
        }
      } else if (status === 'FAILED') {
        await this._failTransaction(ref, body.reason ?? 'MoMo transaction failed');
      }
      await this._recordProcessed(eventId, 'mtn_momo', body.type ?? 'unknown', body);
    } catch (err: any) {
      this.logger.error(`MTN MoMo webhook error: ${err.message}`);
    }
  }

  /**
   * M-Pesa callback handler (Safaricom calls your ResultURL).
   * Handles both STK Push (deposit) and B2C (withdrawal) callbacks.
   */
  async handleMpesaWebhook(body: Record<string, any>): Promise<void> {
    // STK Push result
    const stkBody = body.Body?.stkCallback ?? body.stkCallback;
    if (stkBody) {
      const ref = stkBody.CheckoutRequestID as string;
      const eventId = `mpesa:stk:${ref}`;
      if (!ref || await this._isProcessed(eventId)) return;

      try {
        if (stkBody.ResultCode === 0) {
          const amountItem = (stkBody.CallbackMetadata?.Item as any[])?.find(
            (i: any) => i.Name === 'Amount',
          );
          await this._completeDeposit(ref, amountItem?.Value ?? 0);
        } else {
          await this._failTransaction(ref, stkBody.ResultDesc ?? 'STK failed');
        }
        await this._recordProcessed(eventId, 'mpesa', 'stk_callback', body);
      } catch (err: any) {
        this.logger.error(`M-Pesa STK webhook error: ${err.message}`);
      }
      return;
    }

    // B2C result
    const b2cBody = body.Result ?? body.result;
    if (b2cBody) {
      const ref = b2cBody.ConversationID as string;
      const eventId = `mpesa:b2c:${ref}`;
      if (!ref || await this._isProcessed(eventId)) return;

      try {
        if (b2cBody.ResultCode === 0) {
          await this._completeWithdrawal(ref);
        } else {
          await this._failTransaction(ref, b2cBody.ResultDesc ?? 'B2C failed');
        }
        await this._recordProcessed(eventId, 'mpesa', 'b2c_result', body);
      } catch (err: any) {
        this.logger.error(`M-Pesa B2C webhook error: ${err.message}`);
      }
    }
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private async _resolveAccount(userId: string): Promise<FacilitatorAccount> {
    const accounts = await this.accountRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    if (accounts.length === 0) {
      throw new BadRequestException(
        'No payment account registered. Complete onboarding at POST /api/v1/qpoints/payment/register.',
      );
    }
    return accounts[0];
  }

  private async _checkDailyLimit(
    userId: string,
    type: FacilitatorTransactionType,
    amount: number,
  ): Promise<void> {
    const limit =
      type === FacilitatorTransactionType.DEPOSIT
        ? this.DAILY_DEPOSIT_LIMIT
        : this.DAILY_WITHDRAW_LIMIT;

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const result = await this.txRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(CAST(t.amount AS DECIMAL)), 0)', 'total')
      .where('t.userId = :userId', { userId })
      .andWhere('t.type = :type', { type })
      .andWhere('t.status IN (:...statuses)', {
        statuses: [
          FacilitatorTransactionStatus.PENDING,
          FacilitatorTransactionStatus.PROCESSING,
          FacilitatorTransactionStatus.COMPLETED,
        ],
      })
      .andWhere('t.createdAt >= :startOfDay', { startOfDay })
      .getRawOne<{ total: string }>();

    const todayTotal = parseFloat(result?.total ?? '0');
    if (todayTotal + amount > limit) {
      throw new BadRequestException(
        `Daily ${type} limit of $${limit.toFixed(2)} exceeded. ` +
          `Today so far: $${todayTotal.toFixed(2)}. Requested: $${amount.toFixed(2)}.`,
      );
    }
  }

  private async _isProcessed(eventId: string): Promise<boolean> {
    const existing = await this.webhookRepo.findOne({ where: { eventId } });
    return !!existing;
  }

  private async _recordProcessed(
    eventId: string,
    provider: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.webhookRepo.insert({ eventId, provider, eventType, payload: payload as any });
    } catch {
      // Unique constraint hit — concurrent delivery, already processed
    }
  }

  private async _completeDeposit(externalId: string, amount: number): Promise<void> {
    const tx = await this.txRepo.findOne({
      where: { externalId, type: FacilitatorTransactionType.DEPOSIT },
    });
    if (!tx || tx.status === FacilitatorTransactionStatus.COMPLETED) return;

    // 1 USD = 1 QP (fixed peg: 1 QP = $1.00)
    const qpAmount = amount;

    tx.status = FacilitatorTransactionStatus.COMPLETED;
    tx.completedAt = new Date();
    await this.txRepo.save(tx);

    // Credit the user's Q-Point market balance (on-ramp: fiat → QP)
    await this.marketBalance.adjustBalance(tx.userId, qpAmount, `deposit_${tx.id}`);

    await this.balanceCache.invalidateCache(tx.userId, tx.provider);
    this.logger.log(
      `Deposit COMPLETED: txId=${tx.id} user=${tx.userId} amount=$${amount} qpCredited=${qpAmount} provider=${tx.provider}`,
    );
  }

  private async _completeWithdrawal(externalId: string): Promise<void> {
    const tx = await this.txRepo.findOne({
      where: { externalId, type: FacilitatorTransactionType.WITHDRAW },
    });
    if (!tx || tx.status === FacilitatorTransactionStatus.COMPLETED) return;

    // 1 QP = $1.00 — debit exactly the amount requested
    const qpAmount = Number(tx.amount);

    tx.status = FacilitatorTransactionStatus.COMPLETED;
    tx.completedAt = new Date();
    await this.txRepo.save(tx);

    // Debit the user's Q-Point market balance (off-ramp: QP → fiat)
    await this.marketBalance.adjustBalance(tx.userId, -qpAmount, `withdrawal_${tx.id}`);

    await this.balanceCache.invalidateCache(tx.userId, tx.provider);
    this.logger.log(
      `Withdrawal COMPLETED: txId=${tx.id} user=${tx.userId} qpDebited=${qpAmount} provider=${tx.provider}`,
    );
  }

  private async _failTransaction(externalId: string, reason: string): Promise<void> {
    // externalId might match either deposit or withdrawal
    const tx = await this.txRepo.findOne({ where: { externalId } });
    if (!tx || tx.status === FacilitatorTransactionStatus.COMPLETED) return;

    tx.status = FacilitatorTransactionStatus.FAILED;
    tx.errorMessage = reason;
    await this.txRepo.save(tx);

    this.logger.warn(
      `Transaction FAILED: txId=${tx.id} externalId=${externalId} reason="${reason}"`,
    );
  }
}
