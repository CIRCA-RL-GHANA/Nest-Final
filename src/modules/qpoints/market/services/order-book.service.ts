import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { QPointOrder, QPointOrderStatus, QPointOrderType } from '../entities/q-point-order.entity';
import { QPointTrade } from '../entities/q-point-trade.entity';
import { MarketBalanceService } from './market-balance.service';
import { SettlementService } from './settlement.service';
import { MarketNotificationService } from './market-notification.service';
import { RevenueService } from '@modules/revenue/revenue.service';

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

@Injectable()
export class OrderBookService {
  private readonly logger = new Logger(OrderBookService.name);

  constructor(
    @InjectRepository(QPointOrder)
    private readonly orderRepo: Repository<QPointOrder>,
    @InjectRepository(QPointTrade)
    private readonly tradeRepo: Repository<QPointTrade>,
    private readonly dataSource: DataSource,
    private readonly balance: MarketBalanceService,
    private readonly settlement: SettlementService,
    private readonly notifications: MarketNotificationService,
    private readonly revenue: RevenueService,
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
    price: number,
    quantity: number,
  ): Promise<CreateOrderResult> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
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
      });
      await orderMgr.save(order);

      // Attempt matching
      const trades = await this._matchOrders(order, orderMgr, tradeMgr);

      return { order, trades };
    });
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

  /** Market buy: match against best available sell orders immediately. */
  async marketBuy(userId: string, quantity: number): Promise<CreateOrderResult> {
    const book = await this.getOrderBook();
    if (!book.sells.length) {
      throw new BadRequestException('No sell orders available. Market buy cannot execute.');
    }
    const bestAsk = book.sells[0].price;
    return this.createOrder(userId, QPointOrderType.BUY, bestAsk, quantity);
  }

  /** Market sell: match against best available buy orders immediately. */
  async marketSell(userId: string, quantity: number): Promise<CreateOrderResult> {
    const book = await this.getOrderBook();
    if (!book.buys.length) {
      throw new BadRequestException('No buy orders available. Market sell cannot execute.');
    }
    const bestBid = book.buys[0].price;
    return this.createOrder(userId, QPointOrderType.SELL, bestBid, quantity);
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

      // Cash settlement is async-fire: do not fail the order if settlement
      // has a transient error – it is retried separately.
      this.settlement
        .createSettlement(trade, buyerId, sellerId, cashAmount)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Settlement error for trade ${trade.id}: ${msg}`);
        });

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
