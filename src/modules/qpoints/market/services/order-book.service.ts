import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { QPointOrder, QPointOrderStatus, QPointOrderType } from '../entities/q-point-order.entity';
import { QPointTrade } from '../entities/q-point-trade.entity';
import { MarketBalanceService } from './market-balance.service';
import { SettlementService } from './settlement.service';
import { MarketNotificationService } from './market-notification.service';
import { RevenueService } from '@modules/revenue/revenue.service';
import { CrossFacilitatorEngineService } from './cross-facilitator-engine.service';
import { FacilitatorProvider } from './payment-facilitator.service';
import { User } from '../../../users/entities/user.entity';
import { TokenBlacklistService } from '../../../auth/token-blacklist.service';

export interface PriceLevel {
  price: number;
  quantity: number;
  count: number;
}

export interface OrderBook {
  buys: PriceLevel[];
  sells: PriceLevel[];
}

export interface MarketStats {
  lastPrice: number | null;
  volume24h: number;
  spreadPercent: number | null;
  bestBid: number | null;
  bestAsk: number | null;
}

export interface CreateOrderResult {
  order: QPointOrder;
  trades: QPointTrade[];
}

/** Minimum price step – prevent zero-spread degenerate matches */
const MIN_STEP = 0.0001;

/** Fixed exchange rate: 1 Q Point = $1.00 USD at all times. */
export const FIXED_QP_PRICE = 1.00;

@Injectable()
export class OrderBookService {
  private readonly logger = new Logger(OrderBookService.name);

  constructor(
    @InjectRepository(QPointOrder)
    private readonly orderRepo: Repository<QPointOrder>,
    @InjectRepository(QPointTrade)
    private readonly tradeRepo: Repository<QPointTrade>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly balance: MarketBalanceService,
    private readonly settlement: SettlementService,
    private readonly notifications: MarketNotificationService,
    private readonly revenue: RevenueService,
    private readonly crossFacilitatorEngine: CrossFacilitatorEngineService,
    private readonly redisFlags: TokenBlacklistService,
  ) {}

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Place a new limit order.  Matching is attempted immediately.
   * Wrapped in a transaction; row-level locks prevent double-fills.
   */
  async createOrder(
    userId: string,
    type: QPointOrderType,
    _price: number,
    quantity: number,
    facilitatorId?: FacilitatorProvider,
  ): Promise<CreateOrderResult> {
    // ISSUE-23: Section 6.2 — trading suspension check (Redis-backed, survives restarts/replicas)
    if (await this.redisFlags.getTradingSuspended()) {
      throw new ServiceUnavailableException(
        'Q Points trading is currently suspended. Per Q Points Terms of Service Section 6.2, ' +
          'the Company may suspend trading at any time without prior notice. ' +
          'During any suspension, you may not place or execute orders. Please try again later.',
      );
    }
    // ISSUE-23: Section 12.2 + 4.3 — per-user flags from DB (survives restarts/replicas)
    const userFlags = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'isQpTerminated', 'isFiatSuspended'] as any,
    });
    if (userFlags?.isQpTerminated) {
      throw new ForbiddenException(
        'Your access to the Q Points System has been terminated by the Company per Section 12.2 ' +
          'of the Q Points Terms of Service. Please contact support if you believe this is in error.',
      );
    }
    if (userFlags?.isFiatSuspended) {
      throw new ForbiddenException(
        'Your Q Points trading privileges have been suspended due to an unresolved fiat settlement ' +
          'failure (Q Points Terms of Service Section 4.3). Please contact support to resolve the ' +
          'outstanding settlement issue before placing new orders.',
      );
    }
    // Price is always fixed at $1.00 per Q Point.
    const price = FIXED_QP_PRICE;
    const result = await this.dataSource.transaction(async (manager: EntityManager) => {
      const orderMgr = manager.getRepository(QPointOrder);
      const tradeMgr = manager.getRepository(QPointTrade);

      // For sell orders: verify the seller has enough QP balance
      if (type === QPointOrderType.SELL) {
        const { balance } = await this.balance.getBalance(userId);
        if (balance < quantity) {
          throw new BadRequestException(
            `Insufficient Q Points balance. Have ${balance}, need ${quantity}.`,
          );
        }
      }

      // Create the order
      const order = orderMgr.create({
        userId,
        type,
        price,
        quantity,
        filledQuantity: 0,
        status: QPointOrderStatus.OPEN,
        facilitatorId,
      });
      await orderMgr.save(order);

      // Attempt matching (with cross-facilitator awareness)
      const trades = await this._matchOrders(order, orderMgr, tradeMgr);

      return { order, trades };
    });

    // ── Cross-facilitator bridge dispatch ────────────────────────────────────
    // If no trades were matched AND we have a facilitatorId, check if the best
    // available counter order is on a different facilitator. If so, and the AI
    // bridge is available, execute a matched-principal bridge transaction.
    if (result.trades.length === 0 && facilitatorId) {
      await this._attemptCrossFacilitatorBridge(result.order, facilitatorId);
    }

    return result;
  }

  /**
   * Check if a cross-facilitator bridge can satisfy an unmatched order.
   * If so, find the best counter-order on a different facilitator and execute
   * the AI bridge (matched principal).
   *
   * This is called after the main matching loop fails to find a same-facilitator
   * counterparty. The AI bridge is the second resort (after peer matching).
   */
  private async _attemptCrossFacilitatorBridge(
    order: QPointOrder,
    userFacilitatorId: FacilitatorProvider,
  ): Promise<void> {
    const oppositeSide = order.type === QPointOrderType.BUY
      ? QPointOrderType.SELL
      : QPointOrderType.BUY;

    // Find the best counter order on a DIFFERENT facilitator
    // ISSUE-22: use TypeORM property names (camelCase), not raw snake_case column names
    const counterOrder = await this.orderRepo
      .createQueryBuilder('o')
      .where('o.type = :side', { side: oppositeSide })
      .andWhere('o.status = :status', { status: QPointOrderStatus.OPEN })
      .andWhere('o.userId != :uid', { uid: order.userId })
      .andWhere('o.facilitatorId IS NOT NULL')
      .andWhere('o.facilitatorId != :fid', { fid: userFacilitatorId })
      .orderBy('o.price', order.type === QPointOrderType.BUY ? 'ASC' : 'DESC')
      .addOrderBy('o.createdAt', 'ASC')
      .getOne();

    if (!counterOrder || !counterOrder.facilitatorId) return;

    const canBridge = await this.crossFacilitatorEngine.isCrossFacilitatorTrade(
      userFacilitatorId,
      counterOrder.facilitatorId as FacilitatorProvider,
    );

    if (!canBridge) return;

    const fillQty = Math.min(
      Number(order.quantity) - Number(order.filledQuantity),
      Number(counterOrder.quantity) - Number(counterOrder.filledQuantity),
    );

    if (fillQty <= 0) return;

    // Determine buyer and seller for the bridge
    const buyerUserId = order.type === QPointOrderType.BUY ? order.userId : counterOrder.userId;
    const buyerFacilitatorId = order.type === QPointOrderType.BUY
      ? userFacilitatorId
      : (counterOrder.facilitatorId as FacilitatorProvider);
    const sellerUserId = order.type === QPointOrderType.SELL ? order.userId : counterOrder.userId;
    const sellerFacilitatorId = order.type === QPointOrderType.SELL
      ? userFacilitatorId
      : (counterOrder.facilitatorId as FacilitatorProvider);

    try {
      await this.crossFacilitatorEngine.executeBridge(
        buyerUserId,
        buyerFacilitatorId,
        sellerUserId,
        sellerFacilitatorId,
        fillQty,
      );

      // Mark both orders as filled (bridge handled the match)
      await this.dataSource.transaction(async (manager: EntityManager) => {
        const orderMgr = manager.getRepository(QPointOrder);
        await orderMgr.update({ id: order.id }, {
          filledQuantity: fillQty,
          status: QPointOrderStatus.FILLED,
        });
        const newCounterFilled = Number(counterOrder.filledQuantity) + fillQty;
        const counterStatus = newCounterFilled >= Number(counterOrder.quantity)
          ? QPointOrderStatus.FILLED
          : QPointOrderStatus.OPEN;
        await orderMgr.update({ id: counterOrder.id }, {
          filledQuantity: newCounterFilled,
          status: counterStatus,
        });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Cross-facilitator bridge attempt failed for order ${order.id}: ${msg}`,
      );
    }
  }

  /** Cancel an open order.  Only the owner may cancel. */
  async cancelOrder(orderId: string, userId: string): Promise<QPointOrder> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const orderMgr = manager.getRepository(QPointOrder);
      const order = await orderMgr
        .createQueryBuilder('o')
        .setLock('pessimistic_write')
        .where('o.id = :id', { id: orderId })
        .getOne();

      if (!order) throw new NotFoundException(`Order ${orderId} not found`);
      if (order.userId !== userId) throw new ForbiddenException('You do not own this order');
      if (order.status !== QPointOrderStatus.OPEN)
        throw new BadRequestException(`Order is already ${order.status}`);

      order.status = QPointOrderStatus.CANCELLED;
      await orderMgr.save(order);
      return order;
    });
  }

  /** Return aggregated order book depth. */
  async getOrderBook(): Promise<OrderBook> {
    // Buy levels: highest price first
    const buysRaw: { price: string; quantity: string; cnt: string }[] = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.price', 'price')
      .addSelect('SUM(o.quantity - o.filled_quantity)', 'quantity')
      .addSelect('COUNT(o.id)', 'cnt')
      .where('o.type = :t', { t: QPointOrderType.BUY })
      .andWhere('o.status = :s', { s: QPointOrderStatus.OPEN })
      .groupBy('o.price')
      .orderBy('o.price', 'DESC')
      .limit(20)
      .getRawMany();

    // Sell levels: lowest price first
    const sellsRaw: { price: string; quantity: string; cnt: string }[] = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.price', 'price')
      .addSelect('SUM(o.quantity - o.filled_quantity)', 'quantity')
      .addSelect('COUNT(o.id)', 'cnt')
      .where('o.type = :t', { t: QPointOrderType.SELL })
      .andWhere('o.status = :s', { s: QPointOrderStatus.OPEN })
      .groupBy('o.price')
      .orderBy('o.price', 'ASC')
      .limit(20)
      .getRawMany();

    return {
      buys: buysRaw.map((r) => ({
        price: parseFloat(r.price),
        quantity: parseFloat(r.quantity),
        count: parseInt(r.cnt, 10),
      })),
      sells: sellsRaw.map((r) => ({
        price: parseFloat(r.price),
        quantity: parseFloat(r.quantity),
        count: parseInt(r.cnt, 10),
      })),
    };
  }

  async getOpenOrders(userId: string): Promise<QPointOrder[]> {
    return this.orderRepo.find({
      where: { userId, status: QPointOrderStatus.OPEN },
      order: { createdAt: 'DESC' },
    });
  }

  async getTradeHistory(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ trades: QPointTrade[]; total: number }> {
    const [trades, total] = await this.tradeRepo
      .createQueryBuilder('t')
      .where('t.buyer_id = :uid OR t.seller_id = :uid', { uid: userId })
      .orderBy('t.created_at', 'DESC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    return { trades, total };
  }

  async getMarketStats(): Promise<MarketStats> {
    const book = await this.getOrderBook();
    const bestBid = book.buys[0]?.price ?? null;
    const bestAsk = book.sells[0]?.price ?? null;

    // Last trade price
    const lastTrade = await this.tradeRepo.findOne({
      order: { createdAt: 'DESC' },
    });

    // 24h volume
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const volResult: { vol: string } = (await this.tradeRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.quantity), 0)', 'vol')
      .where('t.created_at >= :since', { since })
      .getRawOne()) as { vol: string };

    const spreadPercent =
      bestBid && bestAsk
        ? Number(((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100).toFixed(4)
        : null;

    return {
      lastPrice: lastTrade ? Number(lastTrade.price) : null,
      volume24h: parseFloat(volResult.vol),
      spreadPercent: spreadPercent !== null ? parseFloat(spreadPercent) : null,
      bestBid,
      bestAsk,
    };
  }

  /** Market buy: buy Q Points at the fixed price of $1.00. */
  async marketBuy(userId: string, quantity: number, facilitatorId?: FacilitatorProvider): Promise<CreateOrderResult> {
    return this.createOrder(userId, QPointOrderType.BUY, FIXED_QP_PRICE, quantity, facilitatorId);
  }

  /** Market sell: sell Q Points at the fixed price of $1.00. */
  async marketSell(userId: string, quantity: number, facilitatorId?: FacilitatorProvider): Promise<CreateOrderResult> {
    return this.createOrder(userId, QPointOrderType.SELL, FIXED_QP_PRICE, quantity, facilitatorId);
  }

  // -------------------------------------------------------------------------
  // Section 6.2 – Trading suspension management (ISSUE-23: Redis-backed)
  // -------------------------------------------------------------------------

  async suspendTrading(): Promise<void> {
    await this.redisFlags.setTradingSuspended(true);
    this.logger.warn('Q Points trading SUSPENDED (Section 6.2)');
  }

  async resumeTrading(): Promise<void> {
    await this.redisFlags.setTradingSuspended(false);
    this.logger.log('Q Points trading RESUMED');
  }

  async isTradingSuspended(): Promise<boolean> {
    return this.redisFlags.getTradingSuspended();
  }

  // -------------------------------------------------------------------------
  // Section 12.2 – Per-user termination management (ISSUE-23: DB-backed)
  // -------------------------------------------------------------------------

  async terminateUser(userId: string): Promise<void> {
    await this.userRepo.update(userId, { isQpTerminated: true });
    this.logger.warn(`Q Points access TERMINATED for user ${userId} (Section 12.2)`);
  }

  async reinstateUser(userId: string): Promise<void> {
    await this.userRepo.update(userId, { isQpTerminated: false, isFiatSuspended: false });
    this.logger.log(`Q Points access REINSTATED for user ${userId}`);
  }

  async isUserTerminated(userId: string): Promise<boolean> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'isQpTerminated'] as any,
    });
    return !!user?.isQpTerminated;
  }

  // -------------------------------------------------------------------------
  // Section 4.3 – Fiat-failure trading suspension management (ISSUE-23: DB-backed)
  // -------------------------------------------------------------------------

  async suspendUserForFiatFailure(userId: string): Promise<void> {
    await this.userRepo.update(userId, { isFiatSuspended: true });
    this.logger.warn(
      `Q Points trading suspended for user ${userId} due to fiat settlement failure (Section 4.3)`,
    );
  }

  async liftFiatSuspension(userId: string): Promise<void> {
    await this.userRepo.update(userId, { isFiatSuspended: false });
    this.logger.log(`Fiat suspension lifted for user ${userId} (Section 4.3)`);
  }

  async isUserFiatSuspended(userId: string): Promise<boolean> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'isFiatSuspended'] as any,
    });
    return !!user?.isFiatSuspended;
  }

  // ========================================================================
  // Internal matching engine
  // ========================================================================

  /**
   * Price-time priority matching.
   * For a BUY order: find the cheapest open SELL orders with price ≤ order.price.
   * For a SELL order: find the most expensive open BUY orders with price ≥ order.price.
   *
   * Uses SELECT … FOR UPDATE to prevent concurrency races.
   */
  private async _matchOrders(
    order: QPointOrder,
    orderMgr: Repository<QPointOrder>,
    tradeMgr: Repository<QPointTrade>,
  ): Promise<QPointTrade[]> {
    const trades: QPointTrade[] = [];

    const oppositeSide =
      order.type === QPointOrderType.BUY ? QPointOrderType.SELL : QPointOrderType.BUY;

    const priceCondition =
      order.type === QPointOrderType.BUY
        ? 'o.price <= :price' // we pay up to our price
        : 'o.price >= :price'; // we accept down to our price

    const priceOrder = order.type === QPointOrderType.BUY ? 'ASC' : 'DESC'; // best counter-price first

    while (Number(order.quantity) - Number(order.filledQuantity) > MIN_STEP) {
      const remaining = Number(order.quantity) - Number(order.filledQuantity);

      // Find best matching order with row lock
      const counterOrder = await orderMgr
        .createQueryBuilder('o')
        .setLock('pessimistic_write')
        .where('o.type = :side', { side: oppositeSide })
        .andWhere('o.status = :status', { status: QPointOrderStatus.OPEN })
        .andWhere(priceCondition, { price: order.price })
        .andWhere('o.user_id != :uid', { uid: order.userId }) // no self-trade
        .orderBy('o.price', priceOrder)
        .addOrderBy('o.created_at', 'ASC') // time priority
        .getOne();

      if (!counterOrder) break;

      // ── Cross-facilitator check ──────────────────────────────────────────
      // If the incoming order and the counter order are on different facilitators,
      // route through the AI bridge (matched principal) instead of a direct match.
      if (
        order.facilitatorId &&
        counterOrder.facilitatorId &&
        order.facilitatorId !== counterOrder.facilitatorId
      ) {
        const canBridge = await this.crossFacilitatorEngine.isCrossFacilitatorTrade(
          order.facilitatorId,
          counterOrder.facilitatorId,
        );

        if (canBridge) {
          // Break out of the direct-match loop; the bridge will handle this trade.
          // The caller (createOrder) detects no trades were matched and the order
          // stays open — then we execute the bridge below.
          break;
        }
        // If bridge unavailable, fall through to direct match attempt
        // (direct cross-facilitator match is a fallback when bridge is suspended).
      }

      const counterRemaining = Number(counterOrder.quantity) - Number(counterOrder.filledQuantity);

      const fillQty = Math.min(remaining, counterRemaining);
      // Execution price is the resting order's price (maker price)
      const execPrice = Number(counterOrder.price);

      // Create trade record
      const isBuyerOrder = order.type === QPointOrderType.BUY;
      const trade = tradeMgr.create({
        buyOrderId: isBuyerOrder ? order.id : counterOrder.id,
        sellOrderId: isBuyerOrder ? counterOrder.id : order.id,
        price: execPrice,
        quantity: fillQty,
        buyerId: isBuyerOrder ? order.userId : counterOrder.userId,
        sellerId: isBuyerOrder ? counterOrder.userId : order.userId,
      });
      await tradeMgr.save(trade);
      trades.push(trade);

      // Update filled quantities
      order.filledQuantity = Number(order.filledQuantity) + fillQty;
      counterOrder.filledQuantity = Number(counterOrder.filledQuantity) + fillQty;

      if (Number(counterOrder.filledQuantity) >= Number(counterOrder.quantity)) {
        counterOrder.status = QPointOrderStatus.FILLED;
      }
      if (Number(order.filledQuantity) >= Number(order.quantity)) {
        order.status = QPointOrderStatus.FILLED;
      }

      await orderMgr.save([order, counterOrder]);

      // Post-match: adjust QP balances and trigger cash settlement
      // These can throw – their exceptions will roll back the transaction
      const cashAmount = Math.round(execPrice * fillQty * 100) / 100; // round to cents

      const buyerId = isBuyerOrder ? order.userId : counterOrder.userId;
      const sellerId = isBuyerOrder ? counterOrder.userId : order.userId;

      await this.balance.adjustBalance(buyerId, fillQty, `trade_buy_${trade.id}`);
      await this.balance.adjustBalance(sellerId, -fillQty, `trade_sell_${trade.id}`);

      // ISSUE-04: await settlement so a failure rolls back the trade transaction
      await this.settlement.createSettlement(trade, buyerId, sellerId, cashAmount);

      // Charge $0.02 trade fee from the taker (the order that was just placed).
      // Fire-and-forget: a fee failure must not reverse the trade.
      const takerId = isBuyerOrder ? buyerId : sellerId;
      this.revenue
        .chargeTradeFee(takerId, trade.id)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Trade fee error for trade ${trade.id}: ${msg}`);
        });

      // Notify both parties
      this._notifyTrade(trade, buyerId, sellerId, execPrice, fillQty).catch(() => void 0);

      if (order.status === QPointOrderStatus.FILLED) break;
    }

    // Save the final order state (status may have moved to FILLED)
    await orderMgr.save(order);

    return trades;
  }

  private async _notifyTrade(
    trade: QPointTrade,
    buyerId: string,
    sellerId: string,
    price: number,
    quantity: number,
  ): Promise<void> {
    await Promise.all([
      this.notifications.notifyUser(
        buyerId,
        'trade_executed',
        `Bought ${quantity.toFixed(4)} QP at $${price.toFixed(4)}`,
        { tradeId: trade.id, price, quantity },
      ),
      this.notifications.notifyUser(
        sellerId,
        'trade_executed',
        `Sold ${quantity.toFixed(4)} QP at $${price.toFixed(4)}`,
        { tradeId: trade.id, price, quantity },
      ),
    ]);
  }
}
