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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrderBookService } from './services/order-book.service';
import { MarketBalanceService } from './services/market-balance.service';
import { MarketNotificationService } from './services/market-notification.service';
import { AiLiquidityManagerService } from './services/ai-liquidity-manager.service';
import { PaymentFacilitatorService } from './services/payment-facilitator.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CashQuantityDto } from './dto/cash-quantity.dto';
import { ReadNotificationsDto } from './dto/read-notifications.dto';
import { RegisterFacilitatorAccountDto } from './dto/register-facilitator-account.dto';

function userId(req: Request): string {
  return (req as Request & { user: { id: string } }).user.id;
}

@ApiTags('Q Points Market')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('qpoints')
export class QPointsMarketController {
  constructor(
    private readonly orderBook: OrderBookService,
    private readonly balance: MarketBalanceService,
    private readonly notifications: MarketNotificationService,
    private readonly aiManager: AiLiquidityManagerService,
    private readonly facilitator: PaymentFacilitatorService,
  ) {}

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
    return this.orderBook.marketSell(userId(req), dto.quantity);
  }

  @Post('cashin')
  @ApiOperation({
    summary: 'Instant market buy (buy Q Points with fiat)',
    description:
      'Matches against the best available sell order. Returns an error if no match exists.',
  })
  async cashIn(@Req() req: Request, @Body() dto: CashQuantityDto) {
    return this.orderBook.marketBuy(userId(req), dto.quantity);
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

  @Post('payment/register')
  @ApiOperation({
    summary: 'Register a bank account with the payment facilitator',
    description:
      "Submits the user's bank details to the active payment facilitator (Flutterwave or " +
      'Paystack) and persists the resulting recipient/account ID. Must be called before ' +
      'executing cash-in or cash-out trades that settle via fiat.',
  })
  @ApiResponse({ status: 201, description: 'Account registered and stored successfully' })
  async registerPaymentAccount(@Req() req: Request, @Body() dto: RegisterFacilitatorAccountDto) {
    const uid = userId(req);
    const meta: Record<string, string> = {};
    if (dto.accountNumber) meta['accountNumber'] = dto.accountNumber;
    if (dto.bankCode) meta['bankCode'] = dto.bankCode;
    if (dto.accountName) meta['accountName'] = dto.accountName;
    if (dto.type) meta['type'] = dto.type;

    const account = await this.facilitator.registerUserAccount(
      uid,
      dto.email,
      Object.keys(meta).length ? meta : undefined,
      dto.provider,
    );
    return { success: true, provider: account.provider, externalId: account.externalId };
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
  @ApiOperation({ summary: '[Admin] Get AI Liquidity Manager status and config' })
  getAiStatus() {
    return this.aiManager.getStatus();
  }

  @Post('admin/ai-toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Enable or disable the AI Liquidity Manager' })
  toggleAi(@Body() body: { enabled: boolean }) {
    this.aiManager.setEnabled(body.enabled);
    return { enabled: body.enabled };
  }
}
