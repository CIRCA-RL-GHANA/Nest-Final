import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';
import { OrderBookService } from './services/order-book.service';
import { MarketBalanceService } from './services/market-balance.service';
import { MarketNotificationService } from './services/market-notification.service';
import { AiParticipantService } from './services/ai-participant.service';
import { PaymentFacilitatorService } from './services/payment-facilitator.service';
import { FacilitatorRegistryService } from './services/facilitator-registry.service';
import { SettlementService } from './services/settlement.service';
import { QPointsTosService } from './services/qpoints-tos.service';
import { QPointsTosGuard, SkipTosCheck } from './guards/qpoints-tos.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { CashQuantityDto } from './dto/cash-quantity.dto';
import { ReadNotificationsDto } from './dto/read-notifications.dto';
import { RegisterFacilitatorAccountDto } from './dto/register-facilitator-account.dto';
import { AcceptQPointsTosDto } from './dto/accept-tos.dto';

function userId(req: Request): string {
  return (req as Request & { user: { id: string } }).user.id;
}

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? '0.0.0.0';
}

function clientUserAgent(req: Request): string {
  return (req.headers['user-agent'] as string) ?? 'unknown';
}

@ApiTags('Q Points Market')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, QPointsTosGuard)
@Controller('qpoints')
export class QPointsMarketController {
  constructor(
    private readonly orderBook: OrderBookService,
    private readonly balance: MarketBalanceService,
    private readonly notifications: MarketNotificationService,
    private readonly aiParticipant: AiParticipantService,
    private readonly facilitator: PaymentFacilitatorService,
    private readonly facilRegistry: FacilitatorRegistryService,
    private readonly settlement: SettlementService,
    private readonly tosService: QPointsTosService,
  ) {}

  // ---------------------------------------------------------------------- tos

  /**
   * Retrieve the current Q Points Terms of Service.
   * Always public — no ToS acceptance required to read the ToS itself.
   */
  @Get('tos')
  @SkipTosCheck()
  @ApiOperation({
    summary: 'Get the current Q Points Terms of Service',
    description:
      'Returns the current ToS version, effective date, SHA-256 content hash, and full text. ' +
      'Fetch this first and display to the user before calling POST /qpoints/tos/accept.',
  })
  @ApiResponse({ status: 200, description: 'Current ToS content' })
  getCurrentTos() {
    return this.tosService.getCurrentTos();
  }

  /**
   * Check whether the authenticated user has accepted the current ToS.
   * The Flutter app calls this on startup to decide whether to show the gate.
   */
  @Get('tos/status')
  @SkipTosCheck()
  @ApiOperation({ summary: 'Check if the current user has accepted the current Q Points ToS' })
  @ApiResponse({ status: 200, description: '{ accepted: boolean, version: string }' })
  async getTosStatus(@Req() req: Request) {
    const accepted = await this.tosService.hasAcceptedCurrentTos(userId(req));
    const current = this.tosService.getCurrentTos();
    return { accepted, version: current.version, effectiveDate: current.effectiveDate };
  }

  /**
   * Record the authenticated user's acceptance of the Q Points ToS.
   * All three confirmation flags must be true; version must match current.
   */
  @Post('tos/accept')
  @SkipTosCheck()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept the current Q Points Terms of Service',
    description:
      'All three confirmation fields (readConfirmed, riskConfirmed, ageConfirmed) must be true. ' +
      'tosVersion must match the current server version. Idempotent — safe to call if already accepted.',
  })
  @ApiResponse({ status: 200, description: 'Acceptance recorded' })
  @ApiResponse({ status: 400, description: 'Validation error (version mismatch or missing consent)' })
  async acceptTos(@Req() req: Request, @Body() dto: AcceptQPointsTosDto) {
    const record = await this.tosService.recordAcceptance(
      userId(req),
      dto,
      clientIp(req),
      clientUserAgent(req),
    );
    return {
      success: true,
      tosVersion: record.tosVersion,
      acceptedAt: record.acceptedAt,
      platform: record.platform,
    };
  }

  // ---------------------------------------------------------------------- balance

  @Get('balance')
  @ApiOperation({ summary: "Get authenticated user's Q Point market balance" })
  @ApiResponse({ status: 200, description: 'Balance returned' })
  async getBalance(@Req() req: Request) {
    return this.balance.getBalance(userId(req));
  }

  // ---------------------------------------------------------------------- orders

  @Post('orders')
  @ApiOperation({ summary: 'Place a new limit order (buy or sell)' })
  @ApiResponse({
    status: 201,
    description: 'Order created; trades array contains any immediate fills',
  })
  async createOrder(@Req() req: Request, @Body() dto: CreateOrderDto) {
    return this.orderBook.createOrder(userId(req), dto.type, 1.0, dto.quantity);
  }

  @Delete('orders/:orderId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an open order' })
  @ApiResponse({ status: 200, description: 'Order cancelled' })
  async cancelOrder(@Req() req: Request, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.orderBook.cancelOrder(orderId, userId(req));
  }

  @Get('orders/open')
  @ApiOperation({ summary: "List authenticated user's open orders" })
  async getOpenOrders(@Req() req: Request) {
    return this.orderBook.getOpenOrders(userId(req));
  }

  @Get('orders')
  @ApiOperation({ summary: 'Get aggregated order book depth' })
  async getOrderBook() {
    return this.orderBook.getOrderBook();
  }

  // ---------------------------------------------------------------------- trades

  @Get('trades')
  @ApiOperation({ summary: 'Get trade history for the authenticated user' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getTradeHistory(
    @Req() req: Request,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.orderBook.getTradeHistory(
      userId(req),
      limit ? Number(limit) : 20,
      offset ? Number(offset) : 0,
    );
  }

  // ---------------------------------------------------------------------- market

  @Get('market')
  @ApiOperation({ summary: 'Get market statistics (last price, spread, 24-hour volume)' })
  async getMarketStats() {
    return this.orderBook.getMarketStats();
  }

  // ---------------------------------------------------------------------- cash in/out

  @Post('cashout')
  @ApiOperation({
    summary: 'Instant market sell (cash-out Q Points for fiat)',
    description:
      'Matches against the best available buy order. Returns an error if no match exists.',
  })
  async cashOut(@Req() req: Request, @Body() dto: CashQuantityDto) {
    // Section 3.1 – must have a registered facilitator account (KYC) before fiat operations
    const accounts = await this.facilitator.getUserAccounts(userId(req));
    if (accounts.length === 0) {
      throw new BadRequestException(
        'Per Q Points Terms of Service Section 3.1, you must complete identity verification ' +
          'with the payment facilitator before selling Q Points for fiat currency. ' +
          'Please register a payment account at POST /api/v1/qpoints/payment/register.',
      );
    }
    return this.orderBook.marketSell(userId(req), dto.quantity);
  }

  @Post('cashin')
  @ApiOperation({
    summary: 'Instant market buy (buy Q Points with fiat)',
    description:
      'Matches against the best available sell order. Returns an error if no match exists.',
  })
  async cashIn(@Req() req: Request, @Body() dto: CashQuantityDto) {
    // Section 3.1 – must have a registered facilitator account (KYC) before fiat operations
    const accounts = await this.facilitator.getUserAccounts(userId(req));
    if (accounts.length === 0) {
      throw new BadRequestException(
        'Per Q Points Terms of Service Section 3.1, you must complete identity verification ' +
          'with the payment facilitator before buying Q Points with fiat currency. ' +
          'Please register a payment account at POST /api/v1/qpoints/payment/register.',
      );
    }
    return this.orderBook.marketBuy(userId(req), dto.quantity);
  }

  // ---------------------------------------------------------------------- admin: trading suspension (Section 6.2)

  @Get('admin/trading/status')
  @SkipTosCheck()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: '[Admin] Get Q Points trading suspension status (Section 6.2)',
  })
  getTradingStatus() {
    return {
      suspended: this.orderBook.isTradingSuspended(),
      message: this.orderBook.isTradingSuspended()
        ? 'Q Points trading is currently SUSPENDED. Users cannot place or execute orders.'
        : 'Q Points trading is ACTIVE.',
    };
  }

  @Post('admin/trading/suspend')
  @SkipTosCheck()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Suspend Q Points trading (Section 6.2)',
    description:
      'Immediately prevents all order placement. Users will receive a ServiceUnavailableException. ' +
      'Per Terms Section 6.2: the Company may suspend trading at any time without prior notice.',
  })
  suspendTrading() {
    this.orderBook.suspendTrading();
    return { suspended: true, message: 'Q Points trading has been suspended per Section 6.2.' };
  }

  @Post('admin/trading/resume')
  @SkipTosCheck()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Resume Q Points trading (Section 6.2)',
    description: 'Lifts a previous suspension and allows order placement again.',
  })
  resumeTrading() {
    this.orderBook.resumeTrading();
    return { suspended: false, message: 'Q Points trading has been resumed.' };
  }

  // ---------------------------------------------------------------------- notifications

  @Get('notifications')
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiOperation({ summary: 'List market notifications for the authenticated user' })
  async getNotifications(
    @Req() req: Request,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.notifications.getUserNotifications(
      userId(req),
      limit ? Number(limit) : 20,
      offset ? Number(offset) : 0,
    );
  }

  @Post('notifications/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notifications as read' })
  async markNotificationsRead(@Req() req: Request, @Body() dto: ReadNotificationsDto) {
    const uid = userId(req);
    if (dto.all) {
      await this.notifications.markAllAsRead(uid);
    } else if (dto.notificationIds?.length) {
      await this.notifications.markAsRead(dto.notificationIds, uid);
    }
    return { success: true };
  }

  // ---------------------------------------------------------------------- payment onboarding

  /**
   * List available payment facilitators for a country.
   * Public — no auth or ToS acceptance required.
   * Returns all configured facilitators for the given country (or the full catalog).
   */
  @Get('facilitators')
  @SkipTosCheck()
  @ApiOperation({
    summary: 'List available payment facilitators for a country (TOS §2.2)',
    description:
      'Returns the ordered list of payment facilitators available in the given jurisdiction. ' +
      'Per TOS §2.2, the Company works with licensed Facilitators across all jurisdictions globally. ' +
      'Includes account field definitions so the client can render the correct registration form. ' +
      'Omit country to get the full catalog.',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO 3166-1 alpha-2 country code (e.g. GH, NG, GB, US, KE)',
    example: 'GH',
  })
  @ApiResponse({ status: 200, description: 'List of available facilitators with account field definitions' })
  getFacilitators(@Query('country') country?: string) {
    return country ? this.facilRegistry.getForCountry(country) : this.facilRegistry.getCatalog();
  }

  @Post('payment/register')
  @ApiOperation({
    summary: 'Register a payment account with a facilitator (TOS §2.2)',
    description:
      'Registers the user\'s payment account with a supported facilitator for their jurisdiction. ' +
      'Per TOS §2.2, the Company works with licensed Facilitators globally. ' +
      'Use GET /qpoints/facilitators?country=GH first to discover available providers and required fields. ' +
      'Supported providers: flutterwave, paystack (bank account); ' +
      'mtn_momo, mpesa (phone number); wise, stripe (bank account / IBAN). ' +
      'Multiple accounts with different providers can be registered independently.',
  })
  @ApiResponse({ status: 201, description: 'Account registered successfully' })
  async registerPaymentAccount(@Req() req: Request, @Body() dto: RegisterFacilitatorAccountDto) {
    const uid = userId(req);

    // Resolve provider: explicit > jurisdiction-preferred
    let resolvedProvider = dto.provider;
    if (!resolvedProvider && dto.countryCode) {
      resolvedProvider = this.facilRegistry.getPreferred(dto.countryCode) as typeof dto.provider;
    }

    const meta: Record<string, string> = {};
    if (dto.accountNumber) meta['accountNumber'] = dto.accountNumber;
    if (dto.bankCode) meta['bankCode'] = dto.bankCode;
    if (dto.routingCode) meta['routingCode'] = dto.routingCode;
    if (dto.accountName) meta['accountName'] = dto.accountName;
    if (dto.type) meta['type'] = dto.type;
    if (dto.phone) meta['phone'] = dto.phone;
    if (dto.currency) meta['currency'] = dto.currency;
    if (dto.countryCode) meta['countryCode'] = dto.countryCode;

    const account = await this.facilitator.registerUserAccount(
      uid,
      dto.email,
      Object.keys(meta).length ? meta : undefined,
      resolvedProvider,
    );
    return {
      success: true,
      provider: account.provider,
      externalId: account.externalId,
      providerInfo: this.facilRegistry.getProviderInfo(account.provider),
    };
  }

  @Get('payment/accounts')
  @ApiOperation({
    summary: 'List registered payment facilitator accounts for the authenticated user',
  })
  @ApiResponse({ status: 200, description: 'List of registered facilitator accounts' })
  async getPaymentAccounts(@Req() req: Request) {
    return this.facilitator.getUserAccounts(userId(req));
  }

  // ---------------------------------------------------------------------- admin

  @Get('admin/ai-status')
  @SkipTosCheck()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: '[Admin] Get AI Participant status (Section 5.2)',
    description:
      'Returns the operational state of the AI Participant (TOS §5.2). ' +
      'The AI Participant maintains standing last-resort buy and sell orders at $1.00 per Q Point ' +
      '(operational feature, not a legal guarantee of redemption — see TOS §6.1). ' +
      'Peer-to-peer orders are matched first; the AI fills only when no peer counterparty is available. ' +
      'The standingOrdersActive field indicates whether last-resort standing orders are currently being maintained. ' +
      'Disabling the AI Participant suspends last-resort liquidity (operational breach of TOS §5.2, not a legal breach).',
  })
  getAiStatus() {
    return this.aiParticipant.getStatus();
  }

  @Post('admin/ai-toggle')
  @SkipTosCheck()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Enable or disable the AI Participant (Section 5.2)',
    description:
      'Toggles the AI Participant on or off. ' +
      'WARNING: Disabling the AI Participant suspends last-resort standing orders at $1.00 (TOS §5.2 operational commitment). ' +
      'This is an operational suspension only — the Company has no legal obligation to maintain these orders (TOS §6.1). ' +
      'Use only during scheduled Platform maintenance, security incidents, or as required by applicable law. ' +
      'For compliant maintenance windows, prefer POST /qpoints/admin/trading/suspend instead.',
  })
  toggleAi(@Body() body: { enabled: boolean }) {
    this.aiParticipant.setEnabled(body.enabled);
    return { enabled: body.enabled };
  }

  // ---------------------------------------------------------------------- fees (Section 7.1)

  /**
   * Fee schedule disclosure — required by TOS Section 7.1.
   * Always public — no ToS acceptance required to read the fee schedule.
   */
  @Get('fees')
  @SkipTosCheck()
  @ApiOperation({
    summary: 'Get the current Q Points fee schedule (Section 7.1)',
    description:
      'Discloses all fees charged by the Platform for use of the Q Points System, as required by ' +
      'Q Points Terms of Service Section 7.1. Fees may be changed upon notice. Users are solely ' +
      'responsible for any taxes on trades or gains (TOS §7.2).',
  })
  @ApiResponse({ status: 200, description: 'Current fee schedule' })
  getFeeSchedule() {
    return {
      tradeFeePerTrade: 0.02,
      tradeFeeDescription: '$0.02 flat fee charged to the taker on each matched trade',
      orderPlacementFee: 0.00,
      orderPlacementFeeDescription: 'No fee for placing or cancelling a limit order',
      withdrawalFee: 0.00,
      withdrawalFeeDescription: 'No platform fee for Q Points withdrawal; Facilitator fees may apply',
      currency: 'USD',
      pegRate: '1.00 Q Points = $1.00 USD (fixed)',
      taxDisclosure:
        'You are solely responsible for determining and paying any taxes that may apply to ' +
        'your use of Q Points, including any taxes on trades or gains. The Company does not ' +
        'withhold or remit taxes on your behalf, except as required by law. (TOS §7.2)',
      lastUpdated: '2026-04-27',
    };
  }

  // ---------------------------------------------------------------------- user termination (Section 12.2)

  /**
   * Terminate a user's access to the Q Points System.
   * Section 12.2: The Company may terminate your access to the Q Points System at any time,
   * with or without cause, upon notice.
   */
  @Post('admin/users/:userId/terminate')
  @SkipTosCheck()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Terminate a user\'s Q Points trading access (Section 12.2)',
    description:
      'Permanently suspends the specified user\'s ability to place or cancel orders. ' +
      'Per TOS Section 12.2, the Company may terminate access at any time, with or without cause, ' +
      'upon notice. The user retains any existing Q Points balance and may sell through the order ' +
      'book only if the admin separately authorizes a wind-down period.',
  })
  @ApiResponse({ status: 200, description: 'User Q Points access terminated' })
  terminateUserAccess(@Param('userId', ParseUUIDPipe) userId: string) {
    this.orderBook.terminateUser(userId);
    return {
      success: true,
      userId,
      message:
        `User ${userId} Q Points trading access has been terminated per Section 12.2. ` +
        'Please notify the user. They retain any existing Q Points balance.',
    };
  }

  /**
   * Reinstate a terminated user's Q Points trading access.
   * Section 12.2: The Company may reinstate access at its discretion (wind-down period).
   */
  @Post('admin/users/:userId/reinstate')
  @SkipTosCheck()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Reinstate a user\'s Q Points trading access (Section 12.2)',
    description:
      'Lifts a previous termination, restoring the user\'s ability to place orders. ' +
      'Also lifts any fiat-failure suspension (Section 4.3).',
  })
  @ApiResponse({ status: 200, description: 'User Q Points access reinstated' })
  reinstateUserAccess(@Param('userId', ParseUUIDPipe) userId: string) {
    this.orderBook.reinstateUser(userId);
    return { success: true, userId, message: `User ${userId} Q Points trading access reinstated.` };
  }

  /**
   * Check a user's Q Points trading restriction status.
   */
  @Get('admin/users/:userId/trading-status')
  @SkipTosCheck()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "[Admin] Get a user's Q Points trading restriction status (Sections 4.3, 12.2)",
  })
  @ApiResponse({ status: 200, description: 'User trading restriction status' })
  getUserTradingStatus(@Param('userId', ParseUUIDPipe) userId: string) {
    return {
      userId,
      terminated: this.orderBook.isUserTerminated(userId),
      fiatSuspended: this.orderBook.isUserFiatSuspended(userId),
      canTrade:
        !this.orderBook.isUserTerminated(userId) &&
        !this.orderBook.isUserFiatSuspended(userId) &&
        !this.orderBook.isTradingSuspended(),
    };
  }

  // ---------------------------------------------------------------------- settlement webhook (Section 4.3)

  /**
   * Facilitator webhook — confirms that fiat settlement for a trade is complete.
   *
   * COMPLIANCE — TOS §4.3:
   *   "The Company does not initiate, facilitate, or confirm fiat transfers."
   *   "The Platform merely records the Q Points transfer; the fiat transfer is
   *    handled solely by the Facilitator."
   *
   * The Platform itself NEVER initiates fiat transfers.  When the Facilitator
   * completes the peer-to-peer fiat payment between Users, it calls this endpoint
   * to update the settlement record from PENDING → COMPLETED.  This is the ONLY
   * mechanism by which the Platform learns the outcome of a fiat transfer —
   * the Facilitator notifies the Platform, not the other way around.
   *
   * Security: Verify the webhook signature using the shared secret
   * PAYMENT_FACILITATOR_WEBHOOK_SECRET before trusting the payload.
   */
  @Post('settlement/webhook')
  @SkipTosCheck()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Facilitator webhook: confirm fiat settlement (Section 4.3)',
    description:
      'Called by the licensed Facilitator when a peer-to-peer fiat transfer completes. ' +
      'Updates the Platform settlement record from PENDING to COMPLETED. ' +
      'Per TOS §4.3, the Platform does not initiate fiat transfers — it only records the outcome ' +
      'when the Facilitator notifies it via this webhook.',
  })
  @ApiResponse({ status: 200, description: 'Settlement record updated' })
  @ApiResponse({ status: 400, description: 'Missing required fields' })
  async facilitatorSettlementWebhook(
    @Body() body: { reference: string; facilitatorRef: string; status?: string },
    @Req() req: Request,
  ) {
    if (!body.reference || !body.facilitatorRef) {
      throw new BadRequestException('reference and facilitatorRef are required');
    }
    await this.settlement.confirmSettlementByWebhook(body.reference, body.facilitatorRef);
    return { success: true, reference: body.reference, facilitatorRef: body.facilitatorRef };
  }

  // ---------------------------------------------------------------------- fiat-failure suspension (Section 4.3)

  /**
   * Admin: suspend a user's Q Points trading due to failure to complete a fiat transfer.
   * Section 4.3: "The Platform may, at its discretion, suspend Q Points trading
   * privileges if a User fails to complete a fiat transfer or breaches any applicable terms."
   */
  @Post('admin/users/:userId/fiat-suspend')
  @SkipTosCheck()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Suspend a user for fiat settlement failure (Section 4.3)',
  })
  suspendUserFiat(@Param('userId', ParseUUIDPipe) targetUserId: string) {
    this.orderBook.suspendUserForFiatFailure(targetUserId);
    return {
      success: true,
      userId: targetUserId,
      message:
        `User ${targetUserId} Q Points trading suspended due to fiat settlement failure (§4.3). ` +
        'Contact support to resolve the outstanding settlement before lifting this suspension.',
    };
  }
}
