import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { FacilitatorAccount } from '../entities/facilitator-account.entity';

export interface TransferResult {
  transferId: string;
  status: 'succeeded' | 'failed';
  errorMessage?: string;
}

/** All supported payment facilitator providers. */
export type FacilitatorProvider = 'mock' | 'flutterwave' | 'paystack' | 'mtn_momo' | 'mpesa' | 'wise' | 'stripe';

/**
 * Payment Facilitator Service
 *
 * Supports multiple providers selected per-user based on their jurisdiction.
 * Configured providers are determined by the presence of valid API credentials:
 *
 *   mock        – local development / CI (no real money moved)
 *   flutterwave – Pan-African (35+ countries)
 *   paystack    – Nigeria, Ghana, South Africa, Kenya
 *   mtn_momo    – MTN Mobile Money (17 African countries)
 *   mpesa       – Safaricom M-Pesa (Kenya, Tanzania, Mozambique)
 *   wise        – International bank transfers (80+ countries)
 *   stripe      – Stripe Connect (46+ countries)
 *
 * Required env vars per provider:
 *   PAYSTACK_SECRET_KEY
 *   FLUTTERWAVE_SECRET_KEY
 *   MTN_MOMO_API_KEY, MTN_MOMO_USER_ID, MTN_MOMO_BASE_URL
 *   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_B2C_INITIATOR, MPESA_B2C_CREDENTIAL
 *   WISE_API_KEY
 *   STRIPE_SECRET_KEY
 *
 * COMPLIANCE — TOS §4.3:
 * The platform NEVER initiates fiat transfers.  Settlement records are created
 * PENDING; the Facilitator confirms completion via webhook.
 * The transfer() method exists for completeness but is NOT called in production.
 */
@Injectable()
export class PaymentFacilitatorService {
  private readonly logger = new Logger(PaymentFacilitatorService.name);

  // ── Default single-provider (backward-compatible) ──────────────────────
  private readonly provider: FacilitatorProvider;
  private readonly secretKey: string;
  private readonly publicKey: string;
  private readonly currency: string;

  // ── Per-provider config map ────────────────────────────────────────────
  private readonly providerConfigs: Map<
    FacilitatorProvider,
    { secretKey: string; publicKey?: string; apiKey?: string; consumerKey?: string; consumerSecret?: string; baseUrl?: string; currency: string }
  > = new Map();

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(FacilitatorAccount)
    private readonly facilitatorAccountRepo: Repository<FacilitatorAccount>,
  ) {
    this.secretKey = this.config.get<string>('payments.facilitatorSecretKey') ?? '';
    this.publicKey = this.config.get<string>('payments.facilitatorPublicKey') ?? '';
    this.currency = this.config.get<string>('payments.facilitatorCurrency') ?? 'NGN';
    const raw = this.config.get<string>('payments.facilitatorProvider') ?? 'mock';

    // Auto-downgrade to mock when key looks like a placeholder
    this.provider =
      !this.secretKey || this.secretKey.startsWith('mock_') ? 'mock' : (raw as FacilitatorProvider);

    // ── Build per-provider config map ─────────────────────────────────────
    const addProvider = (
      p: FacilitatorProvider,
      secretKey: string,
      currency: string,
      extra?: { publicKey?: string; apiKey?: string; consumerKey?: string; consumerSecret?: string; baseUrl?: string },
    ) => {
      if (secretKey && !secretKey.startsWith('mock_') && !secretKey.startsWith('REPLACE_') && secretKey.length > 8) {
        this.providerConfigs.set(p, { secretKey, currency, ...extra });
      }
    };

    // Legacy single-provider populates the map too
    if (this.provider !== 'mock') {
      addProvider(this.provider, this.secretKey, this.currency, { publicKey: this.publicKey });
    }

    // Per-provider keys (new multi-provider env vars)
    addProvider(
      'paystack',
      config.get<string>('payments.paystack.secretKey') ?? '',
      config.get<string>('payments.paystack.currency') ?? 'NGN',
    );
    addProvider(
      'flutterwave',
      config.get<string>('payments.flutterwave.secretKey') ?? '',
      config.get<string>('payments.flutterwave.currency') ?? 'NGN',
    );
    addProvider(
      'mtn_momo',
      config.get<string>('payments.mtnMomo.apiKey') ?? '',
      config.get<string>('payments.mtnMomo.currency') ?? 'GHS',
      {
        apiKey: config.get<string>('payments.mtnMomo.apiKey'),
        baseUrl: config.get<string>('payments.mtnMomo.baseUrl') ?? 'https://sandbox.momodeveloper.mtn.com',
      },
    );
    addProvider(
      'mpesa',
      config.get<string>('payments.mpesa.consumerKey') ?? '',
      'KES',
      {
        consumerKey: config.get<string>('payments.mpesa.consumerKey'),
        consumerSecret: config.get<string>('payments.mpesa.consumerSecret'),
        baseUrl: 'https://api.safaricom.co.ke',
      },
    );
    addProvider(
      'wise',
      config.get<string>('payments.wise.apiKey') ?? '',
      config.get<string>('payments.wise.currency') ?? 'USD',
      { apiKey: config.get<string>('payments.wise.apiKey') },
    );
    addProvider(
      'stripe',
      config.get<string>('payments.stripe.secretKey') ?? '',
      config.get<string>('payments.stripe.currency') ?? 'USD',
    );

    this.logger.log(
      `PaymentFacilitatorService initialised — default=${this.provider}, ` +
        `configured=[${Array.from(this.providerConfigs.keys()).join(', ')}]`,
    );
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Initiate a peer-to-peer transfer from buyer to seller.
   *
   * @param fromUserId  Buyer's platform user ID (facilitator account must exist)
   * @param toUserId    Seller's platform user ID (facilitator account must exist)
   * @param amount      Cash amount with 2 decimal places
   * @param reference   Idempotency key / trade ID – must be globally unique
   */
  async transfer(
    fromUserId: string,
    toUserId: string,
    amount: number,
    reference: string,
    providerOverride?: FacilitatorProvider,
  ): Promise<TransferResult> {
    const p = providerOverride ?? this.provider;
    this.logger.log(
      `Transfer [${p}]: ${fromUserId} → ${toUserId}, ` +
        `amount=${this.currency} ${amount.toFixed(2)}, ref=${reference}`,
    );

    switch (p) {
      case 'flutterwave':
        return this._flutterwaveTransfer(fromUserId, toUserId, amount, reference);
      case 'paystack':
        return this._paystackTransfer(fromUserId, toUserId, amount, reference);
      case 'mtn_momo':
        return this._mtnMomoTransfer(fromUserId, toUserId, amount, reference);
      case 'mpesa':
        return this._mpesaTransfer(fromUserId, toUserId, amount, reference);
      case 'wise':
        return this._wiseTransfer(fromUserId, toUserId, amount, reference);
      case 'stripe':
        return this._stripeTransfer(fromUserId, toUserId, amount, reference);
      default:
        return this._mockTransfer(reference);
    }
  }

  /**
   * Register / verify a user's facilitator account.
   * Must be called at onboarding and before the first trade.
   * Returns the facilitator-side account/recipient ID to be stored by the caller.
   */
  async ensureUserAccount(
    userId: string,
    email: string,
    meta?: Record<string, string>,
    providerOverride?: FacilitatorProvider,
  ): Promise<string> {
    const p = providerOverride ?? this.provider;
    switch (p) {
      case 'flutterwave':
        return this._flutterwaveEnsureRecipient(userId, email, meta);
      case 'paystack':
        return this._paystackEnsureRecipient(userId, email, meta);
      case 'mtn_momo':
        return this._mtnMomoEnsureRecipient(userId, email, meta);
      case 'mpesa':
        return this._mpesaEnsureRecipient(userId, email, meta);
      case 'wise':
        return this._wiseEnsureRecipient(userId, email, meta);
      case 'stripe':
        return this._stripeEnsureRecipient(userId, email, meta);
      default:
        this.logger.warn(`MOCK: ensureUserAccount for ${userId} (${email})`);
        return `mock_acct_${userId}`;
    }
  }

  /**
   * Register a user's bank account with the facilitator and persist the
   * resulting external ID to the `facilitator_accounts` table.
   *
   * Safe to call multiple times — upserts on (userId, provider).
   *
   * @returns The saved `FacilitatorAccount` entity
   */
  async registerUserAccount(
    userId: string,
    email: string,
    meta?: Record<string, string>,
    providerOverride?: FacilitatorProvider,
  ): Promise<FacilitatorAccount> {
    const provider = providerOverride ?? this.provider;
    const externalId = await this.ensureUserAccount(userId, email, meta, provider);

    const existing = await this.facilitatorAccountRepo.findOne({
      where: { userId, provider },
    });

    if (existing) {
      existing.externalId = externalId;
      existing.metadata = meta as Record<string, unknown> | undefined;
      return this.facilitatorAccountRepo.save(existing);
    }

    const row = this.facilitatorAccountRepo.create({
      userId,
      provider,
      externalId,
      metadata: meta as Record<string, unknown> | undefined,
    });
    return this.facilitatorAccountRepo.save(row);
  }

  /**
   * Retrieve all facilitator accounts for a given user.
   */
  async getUserAccounts(userId: string): Promise<FacilitatorAccount[]> {
    return this.facilitatorAccountRepo.find({ where: { userId } });
  }

  /** Returns true when the provider has valid credentials in this environment. */
  isProviderConfigured(provider: FacilitatorProvider): boolean {
    if (provider === 'mock') return true;
    return this.providerConfigs.has(provider);
  }

  /** Returns all providers with valid credentials. */
  getConfiguredProviders(): FacilitatorProvider[] {
    return Array.from(this.providerConfigs.keys());
  }

  // =========================================================================
  // Flutterwave
  // =========================================================================
  //
  // Docs: https://developer.flutterwave.com/reference/transfers
  // Auth: Authorization: Bearer <secret_key>
  //
  // Flow:
  //   1. Store recipient's account_bank + account_number at onboarding.
  //   2. POST /transfers to initiate; poll or use webhook for final status.
  //
  // Note on P2P legality: Flutterwave is a licensed payment service provider
  // in multiple African jurisdictions. The platform never holds funds – it
  // instructs Flutterwave to move money from buyer's wallet/bank to seller's.

  private async _flutterwaveTransfer(
    fromUserId: string,
    toUserId: string,
    amount: number,
    reference: string,
  ): Promise<TransferResult> {
    // The seller's bank details must be stored in your DB (from onboarding).
    // Here we assume you can retrieve them; replace with a real DB lookup.
    const recipientCode = await this._getFacilitatorAccountId(toUserId, 'flutterwave');

    try {
      const { data } = await axios.post(
        'https://api.flutterwave.com/v3/transfers',
        {
          account_bank: recipientCode.split('|')[0], // e.g. "044"
          account_number: recipientCode.split('|')[1], // e.g. "0690000031"
          amount: Math.round(amount * 100) / 100,
          narration: `QP trade settlement ref:${reference}`,
          currency: this.currency,
          reference,
          callback_url: this.config.get<string>('payments.facilitatorWebhookUrl') ?? '',
          debit_currency: this.currency,
          meta: [{ sender: fromUserId }, { receiver: toUserId }],
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        },
      );

      if (data.status === 'success') {
        return {
          transferId: String(data.data?.id ?? reference),
          status: 'succeeded',
        };
      }

      return {
        transferId: reference,
        status: 'failed',
        errorMessage: data.message ?? 'Flutterwave transfer failed',
      };
    } catch (err: unknown) {
      const msg = this._errMsg(err);
      this.logger.error(`Flutterwave transfer error for ref=${reference}: ${msg}`);
      return { transferId: reference, status: 'failed', errorMessage: msg };
    }
  }

  private async _flutterwaveEnsureRecipient(
    userId: string,
    email: string,
    meta?: Record<string, string>,
  ): Promise<string> {
    // Flutterwave does not have a standalone "recipient" object like Paystack.
    // Instead, bank details are submitted per-transfer. We validate here that
    // the account exists using the account-resolve endpoint.
    try {
      const { data } = await axios.post(
        'https://api.flutterwave.com/v3/accounts/resolve',
        {
          account_number: meta?.accountNumber ?? '',
          account_bank: meta?.bankCode ?? '',
        },
        {
          headers: { Authorization: `Bearer ${this.secretKey}` },
          timeout: 15_000,
        },
      );

      if (data.status === 'success') {
        // Store as "bankCode|accountNumber" composite for use in transfers
        const composite = `${meta?.bankCode}|${meta?.accountNumber}`;
        this.logger.log(
          `Flutterwave account verified for user ${userId}: ${data.data?.account_name}`,
        );
        return composite;
      }

      throw new InternalServerErrorException(
        `Flutterwave account resolution failed for user ${userId}: ${data.message}`,
      );
    } catch (err: unknown) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException(
        `Flutterwave ensureRecipient error for ${userId} (${email}): ${this._errMsg(err)}`,
      );
    }
  }

  // =========================================================================
  // Paystack
  // =========================================================================
  //
  // Docs: https://paystack.com/docs/transfers/single-transfers
  // Auth: Authorization: Bearer <secret_key>
  //
  // Flow:
  //   1. Create a Transfer Recipient (POST /transferrecipient) once per user.
  //   2. Store the returned recipient_code in your DB.
  //   3. POST /transfer with recipient_code to move funds.

  private async _paystackTransfer(
    fromUserId: string,
    toUserId: string,
    amount: number,
    reference: string,
  ): Promise<TransferResult> {
    const recipientCode = await this._getFacilitatorAccountId(toUserId, 'paystack');

    try {
      const { data } = await axios.post(
        'https://api.paystack.co/transfer',
        {
          source: 'balance', // platform's Paystack balance funds the transfer
          amount: Math.round(amount * 100), // kobo / lowest denomination
          recipient: recipientCode,
          reason: `QP trade settlement ref:${reference}`,
          reference,
          currency: this.currency,
        },
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        },
      );

      if (data.status === true) {
        return {
          transferId: data.data?.transfer_code ?? reference,
          status: 'succeeded',
        };
      }

      return {
        transferId: reference,
        status: 'failed',
        errorMessage: data.message ?? 'Paystack transfer failed',
      };
    } catch (err: unknown) {
      const msg = this._errMsg(err);
      this.logger.error(`Paystack transfer error for ref=${reference}: ${msg}`);
      return { transferId: reference, status: 'failed', errorMessage: msg };
    }
  }

  private async _paystackEnsureRecipient(
    userId: string,
    email: string,
    meta?: Record<string, string>,
  ): Promise<string> {
    try {
      const { data } = await axios.post(
        'https://api.paystack.co/transferrecipient',
        {
          type: meta?.type ?? 'nuban', // nuban | mobile_money | basa
          name: meta?.accountName ?? email,
          account_number: meta?.accountNumber ?? '',
          bank_code: meta?.bankCode ?? '',
          currency: this.currency,
          description: `QP market user ${userId}`,
          metadata: { userId, email },
        },
        {
          headers: { Authorization: `Bearer ${this.secretKey}` },
          timeout: 15_000,
        },
      );

      if (data.status === true) {
        const code: string = data.data?.recipient_code;
        this.logger.log(`Paystack recipient created for user ${userId}: ${code}`);
        return code;
      }

      throw new InternalServerErrorException(
        `Paystack recipient creation failed for user ${userId}: ${data.message}`,
      );
    } catch (err: unknown) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException(
        `Paystack ensureRecipient error for ${userId} (${email}): ${this._errMsg(err)}`,
      );
    }
  }

  // =========================================================================
  // Mock
  // =========================================================================

  private _mockTransfer(reference: string): TransferResult {
    this.logger.warn('PaymentFacilitator running in MOCK mode – no real money moved');
    return {
      transferId: `mock_${Date.now()}_${reference}`,
      status: 'succeeded',
    };
  }

  // =========================================================================
  // MTN Mobile Money
  // =========================================================================
  //
  // Docs: https://momodeveloper.mtn.com/docs/services/collection
  // Auth: Bearer OAuth token from POST /{product}/token/ (Base64 apiUser:apiKey)
  // Flow:
  //   1. Validate phone at onboarding: GET /collection/v1_0/accountholder/msisdn/{phone}/active
  //   2. At trade settlement, buyer pays via POST /collection/v1_0/requesttopay
  //
  // externalId: normalized phone (MSISDN without '+')

  private async _mtnMomoTransfer(
    fromUserId: string,
    _toUserId: string,
    amount: number,
    reference: string,
  ): Promise<TransferResult> {
    const cfg = this.providerConfigs.get('mtn_momo');
    if (!cfg) return this._mockTransfer(reference);

    const fromPhone = await this._getFacilitatorAccountId(fromUserId, 'mtn_momo');
    const token = await this._mtnMomoToken(cfg);

    try {
      const { data } = await axios.post(
        `${cfg.baseUrl}/collection/v1_0/requesttopay`,
        {
          amount: String(Math.round(amount * 100) / 100),
          currency: cfg.currency,
          externalId: reference,
          payer: { partyIdType: 'MSISDN', partyId: fromPhone },
          payerMessage: `QP trade settlement ref:${reference}`,
          payeeNote: `QP settlement`,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Reference-Id': reference,
            'X-Target-Environment': (cfg.baseUrl ?? '').includes('sandbox') ? 'sandbox' : 'mtncameroon',
            'Ocp-Apim-Subscription-Key': cfg.apiKey ?? '',
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        },
      );
      return { transferId: reference, status: data ? 'succeeded' : 'failed' };
    } catch (err: unknown) {
      const msg = this._errMsg(err);
      this.logger.error(`MTN MoMo transfer error ref=${reference}: ${msg}`);
      return { transferId: reference, status: 'failed', errorMessage: msg };
    }
  }

  private async _mtnMomoToken(cfg: { secretKey: string; apiKey?: string; baseUrl?: string }): Promise<string> {
    const credentials = Buffer.from(`${cfg.apiKey}:${cfg.secretKey}`).toString('base64');
    const { data } = await axios.post(
      `${cfg.baseUrl}/collection/token/`,
      {},
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Ocp-Apim-Subscription-Key': cfg.apiKey ?? '',
        },
        timeout: 15_000,
      },
    );
    return data.access_token as string;
  }

  private async _mtnMomoEnsureRecipient(
    userId: string,
    _email: string,
    meta?: Record<string, string>,
  ): Promise<string> {
    const cfg = this.providerConfigs.get('mtn_momo');
    if (!cfg) return `mock_acct_${userId}`;

    const phone = (meta?.phone ?? '').replace(/^\+/, ''); // normalize MSISDN
    if (!phone) {
      throw new BadRequestException(`MTN MoMo account registration requires a phone number for user ${userId}`);
    }

    const token = await this._mtnMomoToken(cfg);
    try {
      const { data } = await axios.get(
        `${cfg.baseUrl}/collection/v1_0/accountholder/msisdn/${phone}/active`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Target-Environment': (cfg.baseUrl ?? '').includes('sandbox') ? 'sandbox' : 'mtncameroon',
            'Ocp-Apim-Subscription-Key': cfg.apiKey ?? '',
          },
          timeout: 15_000,
        },
      );
      if (data === true || data?.result === true) {
        this.logger.log(`MTN MoMo account verified for user ${userId}: +${phone}`);
        return phone;
      }
      throw new BadRequestException(`MTN MoMo account ${phone} not found or not active`);
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException(
        `MTN MoMo ensureRecipient error for ${userId}: ${this._errMsg(err)}`,
      );
    }
  }

  // =========================================================================
  // M-Pesa (Safaricom Daraja)
  // =========================================================================
  //
  // Docs: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
  // Auth: OAuth from POST /oauth/v1/generate (Basic consumerKey:consumerSecret)
  // Flow:
  //   1. Validate/register phone at onboarding.
  //   2. B2C transfer: POST /mpesa/b2c/v3/paymentrequest (business to customer).
  //
  // externalId: phone number (MSISDN)

  private async _mpesaTransfer(
    _fromUserId: string,
    toUserId: string,
    amount: number,
    reference: string,
  ): Promise<TransferResult> {
    const cfg = this.providerConfigs.get('mpesa');
    if (!cfg) return this._mockTransfer(reference);

    const toPhone = await this._getFacilitatorAccountId(toUserId, 'mpesa');
    const token = await this._mpesaToken(cfg);

    try {
      const { data } = await axios.post(
        `${cfg.baseUrl}/mpesa/b2c/v3/paymentrequest`,
        {
          OriginatorConversationID: reference,
          InitiatorName: this.config.get('payments.mpesa.initiatorName') ?? 'QPointsInitiator',
          SecurityCredential: this.config.get('payments.mpesa.securityCredential') ?? '',
          CommandID: 'BusinessPayment',
          Amount: Math.round(amount),
          PartyA: this.config.get('payments.mpesa.shortCode') ?? '',
          PartyB: toPhone,
          Remarks: `QP settlement ref:${reference}`,
          QueueTimeOutURL: this.config.get('payments.facilitatorWebhookUrl') ?? '',
          ResultURL: this.config.get('payments.facilitatorWebhookUrl') ?? '',
          Occasion: reference,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        },
      );
      return {
        transferId: data.ConversationID ?? reference,
        status: data.ResponseCode === '0' ? 'succeeded' : 'failed',
        errorMessage: data.ResponseCode !== '0' ? data.ResponseDescription : undefined,
      };
    } catch (err: unknown) {
      const msg = this._errMsg(err);
      this.logger.error(`M-Pesa transfer error ref=${reference}: ${msg}`);
      return { transferId: reference, status: 'failed', errorMessage: msg };
    }
  }

  private async _mpesaToken(cfg: { consumerKey?: string; consumerSecret?: string; baseUrl?: string }): Promise<string> {
    const credentials = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
    const { data } = await axios.get(
      `${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${credentials}` }, timeout: 15_000 },
    );
    return data.access_token as string;
  }

  private async _mpesaEnsureRecipient(
    userId: string,
    _email: string,
    meta?: Record<string, string>,
  ): Promise<string> {
    const phone = (meta?.phone ?? '').replace(/^\+/, '');
    if (!phone) {
      throw new BadRequestException(`M-Pesa account registration requires a phone number for user ${userId}`);
    }
    // M-Pesa does not have a standalone recipient registration endpoint;
    // we store the phone number which is used directly in B2C transfers.
    this.logger.log(`M-Pesa account registered for user ${userId}: ${phone}`);
    return phone;
  }

  // =========================================================================
  // Wise (TransferWise)
  // =========================================================================
  //
  // Docs: https://docs.wise.com/api-docs/guides/send-money
  // Auth: Bearer <api_key>
  // Flow:
  //   1. Create recipient account: POST /v1/accounts
  //   2. Create quote: POST /v1/quotes
  //   3. Create transfer: POST /v1/transfers
  //   4. Fund transfer: POST /v3/profiles/{profileId}/transfers/{transferId}/payments
  //
  // externalId: Wise account ID (number)

  private async _wiseTransfer(
    fromUserId: string,
    toUserId: string,
    amount: number,
    reference: string,
  ): Promise<TransferResult> {
    const cfg = this.providerConfigs.get('wise');
    if (!cfg) return this._mockTransfer(reference);

    const targetAccountId = await this._getFacilitatorAccountId(toUserId, 'wise');
    const profileId = this.config.get<string>('payments.wise.profileId') ?? '';

    try {
      // 1. Create quote
      const { data: quote } = await axios.post(
        'https://api.wise.com/v1/quotes',
        {
          profile: profileId,
          sourceCurrency: cfg.currency,
          targetCurrency: cfg.currency,
          targetAmount: amount,
          payOut: 'BANK_TRANSFER',
        },
        {
          headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/json' },
          timeout: 30_000,
        },
      );

      // 2. Create transfer
      const { data: transfer } = await axios.post(
        'https://api.wise.com/v1/transfers',
        {
          targetAccount: Number(targetAccountId),
          quoteUuid: quote.id,
          customerTransactionId: reference,
          details: { reference: `QP settlement ${reference}` },
        },
        {
          headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/json' },
          timeout: 30_000,
        },
      );

      // 3. Fund it
      await axios.post(
        `https://api.wise.com/v3/profiles/${profileId}/transfers/${transfer.id}/payments`,
        { type: 'BALANCE' },
        {
          headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/json' },
          timeout: 30_000,
        },
      );

      return { transferId: String(transfer.id), status: 'succeeded' };
    } catch (err: unknown) {
      const msg = this._errMsg(err);
      this.logger.error(`Wise transfer error ref=${reference}: ${msg}`);
      return { transferId: reference, status: 'failed', errorMessage: msg };
    }
  }

  private async _wiseEnsureRecipient(
    userId: string,
    email: string,
    meta?: Record<string, string>,
  ): Promise<string> {
    const cfg = this.providerConfigs.get('wise');
    if (!cfg) return `mock_acct_${userId}`;

    const profileId = this.config.get<string>('payments.wise.profileId') ?? '';

    try {
      const { data } = await axios.post(
        'https://api.wise.com/v1/accounts',
        {
          profile: profileId,
          accountHolderName: meta?.accountName ?? email,
          currency: meta?.currency ?? cfg.currency,
          type: 'iban',
          details: {
            legalType: 'PRIVATE',
            IBAN: meta?.accountNumber ?? '',
            BIC: meta?.routingCode ?? '',
            address: { country: meta?.countryCode ?? 'GH', city: '', postCode: '', firstLine: '' },
          },
        },
        {
          headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/json' },
          timeout: 15_000,
        },
      );
      this.logger.log(`Wise recipient created for user ${userId}: account ${data.id}`);
      return String(data.id);
    } catch (err: unknown) {
      throw new InternalServerErrorException(
        `Wise ensureRecipient error for ${userId}: ${this._errMsg(err)}`,
      );
    }
  }

  // =========================================================================
  // Stripe Connect
  // =========================================================================
  //
  // Docs: https://stripe.com/docs/connect/collect-then-transfer-guide
  // Auth: Bearer sk_live_...
  // Flow:
  //   1. Create a Stripe Customer or Connect account for the user at onboarding.
  //   2. Add an external (bank) account to the customer.
  //   3. Use Transfer or Payout API to move funds to the bank account.
  //
  // externalId: Stripe customer ID (cus_...)

  private async _stripeTransfer(
    _fromUserId: string,
    toUserId: string,
    amount: number,
    reference: string,
  ): Promise<TransferResult> {
    const cfg = this.providerConfigs.get('stripe');
    if (!cfg) return this._mockTransfer(reference);

    const stripeCustomerId = await this._getFacilitatorAccountId(toUserId, 'stripe');

    try {
      const { data } = await axios.post(
        'https://api.stripe.com/v1/payouts',
        new URLSearchParams({
          amount: String(Math.round(amount * 100)),
          currency: cfg.currency.toLowerCase(),
          description: `QP settlement ref:${reference}`,
          metadata: JSON.stringify({ reference, toUserId }),
          destination: stripeCustomerId,
        }).toString(),
        {
          headers: {
            Authorization: `Bearer ${cfg.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': reference,
          },
          timeout: 30_000,
        },
      );
      return { transferId: data.id, status: data.status === 'paid' ? 'succeeded' : 'failed' };
    } catch (err: unknown) {
      const msg = this._errMsg(err);
      this.logger.error(`Stripe payout error ref=${reference}: ${msg}`);
      return { transferId: reference, status: 'failed', errorMessage: msg };
    }
  }

  private async _stripeEnsureRecipient(
    userId: string,
    email: string,
    meta?: Record<string, string>,
  ): Promise<string> {
    const cfg = this.providerConfigs.get('stripe');
    if (!cfg) return `mock_acct_${userId}`;

    try {
      // Create a Stripe Customer for the user
      const { data: customer } = await axios.post(
        'https://api.stripe.com/v1/customers',
        new URLSearchParams({
          email,
          name: meta?.accountName ?? email,
          metadata: JSON.stringify({ userId }),
          description: `QP market user ${userId}`,
        }).toString(),
        {
          headers: {
            Authorization: `Bearer ${cfg.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 15_000,
        },
      );

      this.logger.log(`Stripe customer created for user ${userId}: ${customer.id}`);
      return customer.id as string;
    } catch (err: unknown) {
      throw new InternalServerErrorException(
        `Stripe ensureRecipient error for ${userId}: ${this._errMsg(err)}`,
      );
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Retrieve the facilitator-side account / recipient ID for a user.
   * In production this should query a `facilitator_accounts` table.
   * Subclass or extend this service to inject that repository.
   */
  protected async _getFacilitatorAccountId(
    userId: string,
    provider: FacilitatorProvider,
  ): Promise<string> {
    const row = await this.facilitatorAccountRepo.findOne({
      where: { userId, provider },
    });
    if (!row) {
      throw new BadRequestException(
        `User ${userId} has no ${provider} facilitator account. ` +
          'Please complete payment onboarding first.',
      );
    }
    return row.externalId;
  }

  private _errMsg(err: unknown): string {
    if (axios.isAxiosError(err)) {
      // Cast explicitly — type narrowing from isAxiosError requires axios types to be loaded.
      const axErr = err as { response?: { data?: Record<string, unknown> }; message: string };
      const resp = axErr.response?.data;
      return (resp?.['message'] as string) ?? (resp?.['error'] as string) ?? axErr.message;
    }
    return err instanceof Error ? err.message : String(err);
  }

  // =========================================================================
  // Deposit (On-Ramp) — createDepositSession
  // =========================================================================
  //
  // Returns { checkoutUrl, clientSecret, externalId }.
  //   checkoutUrl  – hosted checkout page the user opens in a browser
  //   clientSecret – Stripe PaymentIntent secret (for native SDK, may be null)
  //   externalId   – the provider's transaction / session / reference ID

  async createDepositSession(
    userId: string,
    externalAccountId: string,
    amount: number,
    currency: string,
    provider: FacilitatorProvider,
    idempotencyKey: string,
  ): Promise<{ checkoutUrl: string | null; clientSecret: string | null; externalId: string }> {
    const cfg = this.providerConfigs.get(provider);
    switch (provider) {
      case 'stripe':
        return this._stripeCreateDeposit(externalAccountId, amount, currency, idempotencyKey, cfg?.secretKey);
      case 'paystack':
        return this._paystackCreateDeposit(userId, amount, currency, idempotencyKey, cfg?.secretKey);
      case 'flutterwave':
        return this._flutterwaveCreateDeposit(userId, amount, currency, idempotencyKey, cfg?.secretKey);
      case 'mtn_momo':
        return this._mtnMomoCreateDeposit(externalAccountId, amount, currency, idempotencyKey, cfg);
      case 'mpesa':
        return this._mpesaCreateDeposit(externalAccountId, amount, idempotencyKey, cfg);
      case 'wise':
        throw new BadRequestException('Wise does not support direct deposits. Use a bank transfer to your Wise USD balance and the platform will be notified via webhook.');
      case 'mock':
      default:
        return {
          checkoutUrl: `https://mock.checkout.genieinprompt.app/deposit?ref=${idempotencyKey}&amount=${amount}`,
          clientSecret: null,
          externalId: `mock_dep_${idempotencyKey}`,
        };
    }
  }

  private async _stripeCreateDeposit(
    connectedAccountId: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
    secretKey?: string,
  ): Promise<{ checkoutUrl: string | null; clientSecret: string | null; externalId: string }> {
    const key = secretKey ?? this.config.get<string>('payments.stripe.secretKey');
    if (!key) throw new BadRequestException('Stripe credentials not configured.');

    const returnBase = this.config.get<string>('payments.depositReturnUrl') ?? 'https://app.genieinprompt.app/deposit';

    const params = new URLSearchParams({
      mode: 'payment',
      'payment_method_types[]': 'card',
      'line_items[0][price_data][currency]': currency.toLowerCase(),
      'line_items[0][price_data][product_data][name]': 'Account Deposit',
      'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)),
      'line_items[0][quantity]': '1',
      'payment_intent_data[transfer_data][destination]': connectedAccountId,
      'success_url': `${returnBase}/success?ref=${idempotencyKey}`,
      'cancel_url': `${returnBase}/cancel?ref=${idempotencyKey}`,
      'client_reference_id': idempotencyKey,
    });

    const res = await axios.post<{ id: string; url: string }>(
      'https://api.stripe.com/v1/checkout/sessions',
      params.toString(),
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': idempotencyKey,
        },
        timeout: 15_000,
      },
    );
    return { checkoutUrl: res.data.url, clientSecret: null, externalId: res.data.id };
  }

  private async _paystackCreateDeposit(
    userId: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
    secretKey?: string,
  ): Promise<{ checkoutUrl: string | null; clientSecret: string | null; externalId: string }> {
    const key = secretKey ?? this.config.get<string>('payments.paystack.secretKey');
    if (!key) throw new BadRequestException('Paystack credentials not configured.');

    const returnUrl = this.config.get<string>('payments.depositReturnUrl') ?? 'https://app.genieinprompt.app/deposit';

    const res = await axios.post<{
      status: boolean;
      data: { authorization_url: string; reference: string };
    }>(
      'https://api.paystack.co/transaction/initialize',
      {
        email: `${userId}@platform.genieinprompt.app`,
        amount: Math.round(amount * 100), // kobo
        currency: currency.toUpperCase(),
        reference: idempotencyKey.replace(/:/g, '-').slice(0, 100),
        callback_url: `${returnUrl}/success`,
        channels: ['card', 'bank', 'mobile_money'],
        metadata: { platform_user_id: userId, idempotency_key: idempotencyKey },
      },
      {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 15_000,
      },
    );

    if (!res.data.status) throw new BadRequestException('Paystack deposit initialization failed.');

    return {
      checkoutUrl: res.data.data.authorization_url,
      clientSecret: null,
      externalId: res.data.data.reference,
    };
  }

  private async _flutterwaveCreateDeposit(
    userId: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
    secretKey?: string,
  ): Promise<{ checkoutUrl: string | null; clientSecret: string | null; externalId: string }> {
    const key = secretKey ?? this.config.get<string>('payments.flutterwave.secretKey');
    if (!key) throw new BadRequestException('Flutterwave credentials not configured.');

    const returnUrl = this.config.get<string>('payments.depositReturnUrl') ?? 'https://app.genieinprompt.app/deposit';

    const txRef = idempotencyKey.replace(/:/g, '-').slice(0, 100);
    const res = await axios.post<{ status: string; data: { link: string } }>(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref: txRef,
        amount,
        currency: currency.toUpperCase(),
        redirect_url: `${returnUrl}/success`,
        customer: {
          email: `${userId}@platform.genieinprompt.app`,
          name: `Platform User ${userId.slice(0, 8)}`,
        },
        customizations: {
          title: 'genie help Deposit',
          description: `Deposit $${amount} to your genie help account`,
        },
        meta: { platform_user_id: userId, idempotency_key: idempotencyKey },
      },
      {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 15_000,
      },
    );

    if (res.data.status !== 'success') throw new BadRequestException('Flutterwave deposit initialization failed.');

    return {
      checkoutUrl: res.data.data.link,
      clientSecret: null,
      externalId: txRef,
    };
  }

  private async _mtnMomoCreateDeposit(
    phoneNumber: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
    cfg?: { apiKey?: string; baseUrl?: string },
  ): Promise<{ checkoutUrl: string | null; clientSecret: string | null; externalId: string }> {
    const apiKey = cfg?.apiKey ?? this.config.get<string>('payments.mtnMomo.apiKey');
    const momoUserId = this.config.get<string>('payments.mtnMomo.userId');
    const baseUrl = cfg?.baseUrl ?? 'https://sandbox.momodeveloper.mtn.com';

    if (!apiKey || !momoUserId) throw new BadRequestException('MTN MoMo credentials not configured.');

    // Obtain access token
    const tokenRes = await axios.post<{ access_token: string }>(
      `${baseUrl}/collection/token/`,
      {},
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${momoUserId}:${apiKey}`).toString('base64')}`,
          'Ocp-Apim-Subscription-Key': apiKey,
        },
        timeout: 10_000,
      },
    );
    const token = tokenRes.data?.access_token;
    if (!token) throw new BadRequestException('MTN MoMo token exchange failed.');

    const referenceId = idempotencyKey.replace(/[^a-f0-9-]/g, '').slice(0, 36);

    // Initiate Request to Pay (async — webhook delivers result)
    await axios.post(
      `${baseUrl}/collection/v1_0/requesttopay`,
      {
        amount: String(Math.round(amount * 100) / 100),
        currency: currency.toUpperCase(),
        externalId: referenceId,
        payer: { partyIdType: 'MSISDN', partyId: phoneNumber },
        payerMessage: 'genie help deposit',
        payeeNote: `Ref: ${referenceId}`,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Ocp-Apim-Subscription-Key': apiKey,
          'X-Reference-Id': referenceId,
          'X-Target-Environment': baseUrl.includes('sandbox') ? 'sandbox' : 'mtncongo',
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      },
    );

    return { checkoutUrl: null, clientSecret: null, externalId: referenceId };
  }

  private async _mpesaCreateDeposit(
    phoneNumber: string,
    amount: number,
    idempotencyKey: string,
    cfg?: { consumerKey?: string; consumerSecret?: string; baseUrl?: string },
  ): Promise<{ checkoutUrl: string | null; clientSecret: string | null; externalId: string }> {
    const consumerKey = cfg?.consumerKey ?? this.config.get<string>('payments.mpesa.consumerKey');
    const consumerSecret = cfg?.consumerSecret ?? this.config.get<string>('payments.mpesa.consumerSecret');
    const shortcode = this.config.get<string>('payments.mpesa.shortcode') ?? '';
    const passkey = this.config.get<string>('payments.mpesa.passkey') ?? '';
    const callbackUrl = this.config.get<string>('payments.mpesa.callbackUrl') ?? '';
    const baseUrl = cfg?.baseUrl ?? 'https://api.safaricom.co.ke';

    if (!consumerKey || !consumerSecret) throw new BadRequestException('M-Pesa credentials not configured.');

    // Step 1: OAuth token
    const tokenRes = await axios.get<{ access_token: string }>(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        auth: { username: consumerKey, password: consumerSecret },
        timeout: 10_000,
      },
    );
    const token = tokenRes.data?.access_token;
    if (!token) throw new BadRequestException('M-Pesa token fetch failed.');

    // Step 2: STK Push
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    const checkoutRequestId = idempotencyKey.slice(0, 36);

    const res = await axios.post<{ CheckoutRequestID: string; ResponseCode: string }>(
      `${baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: phoneNumber,
        PartyB: shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: callbackUrl,
        AccountReference: checkoutRequestId,
        TransactionDesc: 'genie help Deposit',
      },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15_000,
      },
    );

    if (res.data?.ResponseCode !== '0') throw new BadRequestException('M-Pesa STK Push failed.');

    return { checkoutUrl: null, clientSecret: null, externalId: res.data.CheckoutRequestID };
  }

  // =========================================================================
  // Withdrawal (Off-Ramp) — createWithdrawalPayout
  // =========================================================================

  async createWithdrawalPayout(
    userId: string,
    externalAccountId: string,
    amount: number,
    currency: string,
    provider: FacilitatorProvider,
    payoutMethodId: string,
    idempotencyKey: string,
  ): Promise<{ externalId: string }> {
    const cfg = this.providerConfigs.get(provider);
    switch (provider) {
      case 'stripe':
        return this._stripeCreatePayout(externalAccountId, amount, currency, payoutMethodId, idempotencyKey, cfg?.secretKey);
      case 'paystack':
        return this._paystackCreateTransfer(amount, currency, payoutMethodId, idempotencyKey, cfg?.secretKey);
      case 'flutterwave':
        return this._flutterwaveCreateTransfer(amount, currency, payoutMethodId, idempotencyKey, cfg?.secretKey);
      case 'mtn_momo':
        return this._mtnMomoCreateDisbursement(payoutMethodId, amount, currency, idempotencyKey, cfg);
      case 'mpesa':
        return this._mpesaCreateB2C(payoutMethodId, amount, idempotencyKey, cfg);
      case 'wise':
        return this._wiseCreateTransfer(amount, currency, payoutMethodId, idempotencyKey, cfg?.apiKey);
      case 'mock':
      default:
        return { externalId: `mock_payout_${idempotencyKey}` };
    }
  }

  private async _stripeCreatePayout(
    connectedAccountId: string,
    amount: number,
    currency: string,
    destination: string,
    idempotencyKey: string,
    secretKey?: string,
  ): Promise<{ externalId: string }> {
    const key = secretKey ?? this.config.get<string>('payments.stripe.secretKey');
    if (!key) throw new BadRequestException('Stripe credentials not configured.');

    const params = new URLSearchParams({
      amount: String(Math.round(amount * 100)),
      currency: currency.toLowerCase(),
      destination,
    });

    const res = await axios.post<{ id: string }>(
      'https://api.stripe.com/v1/payouts',
      params.toString(),
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Stripe-Account': connectedAccountId,
          'Idempotency-Key': idempotencyKey,
        },
        timeout: 15_000,
      },
    );
    return { externalId: res.data.id };
  }

  private async _paystackCreateTransfer(
    amount: number,
    currency: string,
    recipientCode: string,
    idempotencyKey: string,
    secretKey?: string,
  ): Promise<{ externalId: string }> {
    const key = secretKey ?? this.config.get<string>('payments.paystack.secretKey');
    if (!key) throw new BadRequestException('Paystack credentials not configured.');

    const ref = idempotencyKey.replace(/:/g, '-').slice(0, 100);
    const res = await axios.post<{ status: boolean; data: { transfer_code: string } }>(
      'https://api.paystack.co/transfer',
      {
        source: 'balance',
        amount: Math.round(amount * 100),
        recipient: recipientCode,
        reason: 'genie help withdrawal',
        reference: ref,
        currency: currency.toUpperCase(),
      },
      {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 15_000,
      },
    );
    if (!res.data.status) throw new BadRequestException('Paystack transfer initiation failed.');
    return { externalId: res.data.data.transfer_code };
  }

  private async _flutterwaveCreateTransfer(
    amount: number,
    currency: string,
    recipientComposite: string,
    idempotencyKey: string,
    secretKey?: string,
  ): Promise<{ externalId: string }> {
    const key = secretKey ?? this.config.get<string>('payments.flutterwave.secretKey');
    if (!key) throw new BadRequestException('Flutterwave credentials not configured.');

    const [bankCode, accountNumber] = recipientComposite.split('|');
    const ref = idempotencyKey.replace(/:/g, '-').slice(0, 100);

    const res = await axios.post<{ status: string; data: { id: number } }>(
      'https://api.flutterwave.com/v3/transfers',
      {
        account_bank: bankCode,
        account_number: accountNumber,
        amount,
        narration: 'genie help withdrawal',
        currency: currency.toUpperCase(),
        reference: ref,
        debit_currency: currency.toUpperCase(),
      },
      {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 15_000,
      },
    );
    if (res.data.status !== 'success') throw new BadRequestException('Flutterwave transfer initiation failed.');
    return { externalId: String(res.data.data.id) };
  }

  private async _mtnMomoCreateDisbursement(
    phoneNumber: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
    cfg?: { apiKey?: string; baseUrl?: string },
  ): Promise<{ externalId: string }> {
    const apiKey = cfg?.apiKey ?? this.config.get<string>('payments.mtnMomo.apiKey');
    const momoUserId = this.config.get<string>('payments.mtnMomo.userId');
    const baseUrl = cfg?.baseUrl ?? 'https://sandbox.momodeveloper.mtn.com';

    if (!apiKey || !momoUserId) throw new BadRequestException('MTN MoMo credentials not configured.');

    const tokenRes = await axios.post<{ access_token: string }>(
      `${baseUrl}/disbursement/token/`,
      {},
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${momoUserId}:${apiKey}`).toString('base64')}`,
          'Ocp-Apim-Subscription-Key': apiKey,
        },
        timeout: 10_000,
      },
    );
    const token = tokenRes.data?.access_token;
    if (!token) throw new BadRequestException('MTN MoMo token exchange failed.');

    const referenceId = idempotencyKey.replace(/[^a-f0-9-]/g, '').slice(0, 36);

    await axios.post(
      `${baseUrl}/disbursement/v1_0/transfer`,
      {
        amount: String(amount),
        currency: currency.toUpperCase(),
        externalId: referenceId,
        payee: { partyIdType: 'MSISDN', partyId: phoneNumber },
        payerMessage: 'genie help withdrawal',
        payeeNote: `Ref: ${referenceId}`,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Ocp-Apim-Subscription-Key': apiKey,
          'X-Reference-Id': referenceId,
          'X-Target-Environment': baseUrl.includes('sandbox') ? 'sandbox' : 'mtncongo',
        },
        timeout: 15_000,
      },
    );
    return { externalId: referenceId };
  }

  private async _mpesaCreateB2C(
    phoneNumber: string,
    amount: number,
    idempotencyKey: string,
    cfg?: { consumerKey?: string; consumerSecret?: string; baseUrl?: string },
  ): Promise<{ externalId: string }> {
    const consumerKey = cfg?.consumerKey ?? this.config.get<string>('payments.mpesa.consumerKey');
    const consumerSecret = cfg?.consumerSecret ?? this.config.get<string>('payments.mpesa.consumerSecret');
    const initiatorName = this.config.get<string>('payments.mpesa.b2cInitiator') ?? '';
    const credential = this.config.get<string>('payments.mpesa.b2cCredential') ?? '';
    const shortcode = this.config.get<string>('payments.mpesa.shortcode') ?? '';
    const callbackUrl = this.config.get<string>('payments.mpesa.callbackUrl') ?? '';
    const baseUrl = cfg?.baseUrl ?? 'https://api.safaricom.co.ke';

    if (!consumerKey || !consumerSecret) throw new BadRequestException('M-Pesa credentials not configured.');

    const tokenRes = await axios.get<{ access_token: string }>(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { auth: { username: consumerKey, password: consumerSecret }, timeout: 10_000 },
    );
    const token = tokenRes.data?.access_token;
    if (!token) throw new BadRequestException('M-Pesa token fetch failed.');

    const res = await axios.post<{ ConversationID: string; ResponseCode: string }>(
      `${baseUrl}/mpesa/b2c/v1/paymentrequest`,
      {
        InitiatorName: initiatorName,
        SecurityCredential: credential,
        CommandID: 'BusinessPayment',
        Amount: Math.round(amount),
        PartyA: shortcode,
        PartyB: phoneNumber,
        Remarks: 'genie help withdrawal',
        QueueTimeOutURL: callbackUrl,
        ResultURL: callbackUrl,
        Occasion: idempotencyKey.slice(0, 100),
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 },
    );

    if (res.data?.ResponseCode !== '0') throw new BadRequestException('M-Pesa B2C initiation failed.');
    return { externalId: res.data.ConversationID };
  }

  private async _wiseCreateTransfer(
    amount: number,
    currency: string,
    recipientAccountId: string,
    idempotencyKey: string,
    apiKey?: string,
  ): Promise<{ externalId: string }> {
    const key = apiKey ?? this.config.get<string>('payments.wise.apiKey');
    if (!key) throw new BadRequestException('Wise credentials not configured.');

    const authHeader = { Authorization: `Bearer ${key}` };

    // Step 1: Resolve profile
    const profileRes = await axios.get<{ id: number; type: string }[]>(
      'https://api.wise.com/v1/profiles',
      { headers: authHeader, timeout: 10_000 },
    );
    const profile = profileRes.data?.find((p) => p.type === 'business') ?? profileRes.data?.[0];
    if (!profile) throw new BadRequestException('No Wise profile found.');

    // Step 2: Create a quote
    const quoteRes = await axios.post<{ id: string }>(
      `https://api.wise.com/v3/profiles/${profile.id}/quotes`,
      { sourceCurrency: currency.toUpperCase(), targetCurrency: currency.toUpperCase(), targetAmount: amount },
      { headers: authHeader, timeout: 10_000 },
    );

    // Step 3: Create the transfer
    const transferRes = await axios.post<{ id: number }>(
      'https://api.wise.com/v1/transfers',
      {
        targetAccount: recipientAccountId,
        quoteUuid: quoteRes.data.id,
        customerTransactionId: idempotencyKey.slice(0, 36),
        details: { reference: 'genie help withdrawal' },
      },
      { headers: authHeader, timeout: 10_000 },
    );

    // Step 4: Fund the transfer
    await axios.post(
      `https://api.wise.com/v3/profiles/${profile.id}/transfers/${transferRes.data.id}/payments`,
      { type: 'BALANCE' },
      { headers: authHeader, timeout: 10_000 },
    );

    return { externalId: String(transferRes.data.id) };
  }
}
