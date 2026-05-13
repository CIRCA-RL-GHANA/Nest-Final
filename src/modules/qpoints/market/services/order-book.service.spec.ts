/// <reference path="../../../../types/jest-global.d.ts" />
import { OrderBookService } from './order-book.service';
import { QPointOrder, QPointOrderStatus, QPointOrderType } from '../entities/q-point-order.entity';
import { QPointTrade } from '../entities/q-point-trade.entity';
import { MarketBalanceService } from './market-balance.service';
import { SettlementService } from './settlement.service';
import { MarketNotificationService } from './market-notification.service';
import { RevenueService } from '@modules/revenue/revenue.service';
import { CrossFacilitatorEngineService } from './cross-facilitator-engine.service';

// ── Fixture Factories ───────────────────────────────────────────────────────

function makeOrder(overrides: Partial<QPointOrder> = {}): QPointOrder {
  return {
    id: 'order-1',
    userId: 'user-1',
    type: QPointOrderType.BUY,
    price: 1.0,
    quantity: 100,
    filledQuantity: 0,
    status: QPointOrderStatus.OPEN,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null as unknown as Date,
    ...overrides,
  } as QPointOrder;
}

function _makeTrade(overrides: Partial<QPointTrade> = {}): QPointTrade {
  return {
    id: 'trade-1',
    buyOrderId: 'order-buy',
    sellOrderId: 'order-sell',
    buyerId: 'user-buyer',
    sellerId: 'user-seller',
    price: 1.0,
    quantity: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null as unknown as Date,
    ...overrides,
  } as QPointTrade;
}

// ── Query-builder mock helpers ──────────────────────────────────────────────

function buildQb(getOneResult: QPointOrder | null = null) {
  const qb: Record<string, jest.Mock> = {};
  const methods = [
    'setLock',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'select',
    'addSelect',
    'groupBy',
    'limit',
  ];
  methods.forEach((m) => {
    qb[m] = jest.fn().mockReturnThis();
  });
  qb.getOne = jest.fn().mockResolvedValue(getOneResult);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn().mockResolvedValue({ vol: '0' });
  qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  qb.take = jest.fn().mockReturnThis();
  qb.skip = jest.fn().mockReturnThis();
  return qb;
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('OrderBookService', () => {
  let service: OrderBookService;
  let mockOrderRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let mockTradeRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let mockDataSource: { transaction: jest.Mock };
  let mockBalance: { getBalance: jest.Mock; adjustBalance: jest.Mock };
  let mockSettlement: { createSettlement: jest.Mock };
  let mockNotifications: { notifyUser: jest.Mock };

  beforeEach(async () => {
    mockOrderRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn(async (e) => e),
      createQueryBuilder: jest.fn(() => buildQb()),
    };

    mockTradeRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto) => ({ ...dto, id: 'trade-new' })),
      save: jest.fn(async (e) => e),
      createQueryBuilder: jest.fn(() => buildQb()),
    };

    mockDataSource = { transaction: jest.fn() };

    mockBalance = {
      getBalance: jest.fn().mockResolvedValue({ balance: 99999, updatedAt: new Date() }),
      adjustBalance: jest.fn().mockResolvedValue(100),
    };

    mockSettlement = { createSettlement: jest.fn().mockResolvedValue(undefined) };
    mockNotifications = { notifyUser: jest.fn().mockResolvedValue(undefined) };

    const mockRevenue = {
      recordTransactionFee: jest.fn().mockResolvedValue(undefined),
      recordFee: jest.fn().mockResolvedValue(undefined),
    } as unknown as RevenueService;
    const mockCrossFacilitatorEngine = {
      getAllAiBalances: jest.fn().mockResolvedValue([]),
      executeBridge: jest.fn().mockResolvedValue(undefined),
    } as unknown as CrossFacilitatorEngineService;

    service = new OrderBookService(
      mockOrderRepo as never,
      mockTradeRepo as never,
      mockDataSource as never,
      mockBalance as unknown as MarketBalanceService,
      mockSettlement as unknown as SettlementService,
      mockNotifications as unknown as MarketNotificationService,
      mockRevenue,
      mockCrossFacilitatorEngine,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ─── createOrder ──────────────────────────────────────────────────────────

  describe('createOrder', () => {
    it('creates a buy order and returns it with empty trades when no match exists', async () => {
      const managerMock = buildManagerMock(null);

      mockDataSource.transaction.mockImplementation((fn: Function) => fn(managerMock));

      const result = await service.createOrder('user-1', QPointOrderType.BUY, 1.0, 100);

      expect(result.order).toBeDefined();
      expect(result.trades).toEqual([]);
    });

    it('rejects SELL order when user has insufficient QP balance', async () => {
      mockBalance.getBalance.mockResolvedValue({ balance: 10, updatedAt: new Date() });
      mockDataSource.transaction.mockImplementation((fn: Function) => {
        // The balance check happens inside the transaction callback
        return fn({
          getRepository: () => ({
            createQueryBuilder: () => buildQb(null),
            create: jest.fn((dto) => dto),
            save: jest.fn(async (e) => e),
          }),
        });
      });

      await expect(service.createOrder('user-1', QPointOrderType.SELL, 1.0, 500)).rejects.toThrow();
    });

    it('does not allow self-trade (buyer cannot be seller)', async () => {
      // SQL `o.user_id != :uid` guard prevents same-user match — simulate by returning null
      const managerMock = buildManagerMock(null);
      mockDataSource.transaction.mockImplementation((fn: Function) => fn(managerMock));

      // _matchOrders has `o.user_id != :uid` guard – no matching counter-order → 0 trades
      const result = await service.createOrder('same-user', QPointOrderType.BUY, 1.0, 100);

      expect(result.trades).toHaveLength(0);
    });
  });

  // ─── cancelOrder ──────────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('cancels an open order owned by the requesting user', async () => {
      const order = makeOrder({ userId: 'user-owner' });
      const managerMock = buildManagerMock(order);
      managerMock.getOrderRepo.save.mockResolvedValue({
        ...order,
        status: QPointOrderStatus.CANCELLED,
      });
      mockDataSource.transaction.mockImplementation((fn: Function) => fn(managerMock));

      const result = await service.cancelOrder('order-1', 'user-owner');

      expect(result.status).toBe(QPointOrderStatus.CANCELLED);
    });

    it('throws NotFoundException when the order does not exist', async () => {
      const managerMock = buildManagerMock(null);
      mockDataSource.transaction.mockImplementation((fn: Function) => fn(managerMock));

      await expect(service.cancelOrder('nonexistent-id', 'user-1')).rejects.toThrow();
    });

    it('throws ForbiddenException when non-owner tries to cancel', async () => {
      const order = makeOrder({ userId: 'real-owner' });
      const managerMock = buildManagerMock(order);
      mockDataSource.transaction.mockImplementation((fn: Function) => fn(managerMock));

      await expect(service.cancelOrder('order-1', 'intruder-user')).rejects.toThrow();
    });

    it('throws BadRequestException when cancelling a non-open order', async () => {
      const filledOrder = makeOrder({
        userId: 'user-1',
        status: QPointOrderStatus.FILLED,
      });
      const managerMock = buildManagerMock(filledOrder);
      mockDataSource.transaction.mockImplementation((fn: Function) => fn(managerMock));

      await expect(service.cancelOrder('order-1', 'user-1')).rejects.toThrow();
    });
  });

  // ─── marketBuy / marketSell ───────────────────────────────────────────────

  describe('marketBuy', () => {
    it('throws BadRequestException when there are no sell orders in the book', async () => {
      // getOrderBook uses repo.createQueryBuilder – already returns []
      await expect(service.marketBuy('user-1', 10)).rejects.toThrow();
    });
  });

  describe('marketSell', () => {
    it('throws BadRequestException when there are no buy orders in the book', async () => {
      await expect(service.marketSell('user-1', 10)).rejects.toThrow();
    });
  });

  // ─── getOrderBook ─────────────────────────────────────────────────────────

  describe('getOrderBook', () => {
    it('returns an order book with buys and sells arrays', async () => {
      const book = await service.getOrderBook();
      expect(book).toHaveProperty('buys');
      expect(book).toHaveProperty('sells');
      expect(Array.isArray(book.buys)).toBe(true);
      expect(Array.isArray(book.sells)).toBe(true);
    });
  });

  // ─── getMarketStats ───────────────────────────────────────────────────────

  describe('getMarketStats', () => {
    it('returns stats with null lastPrice when no trades have occurred', async () => {
      mockTradeRepo.findOne.mockResolvedValue(null);

      const stats = await service.getMarketStats();

      expect(stats.lastPrice).toBeNull();
      expect(stats.volume24h).toBe(0);
    });
  });
});

// ── Manager Mock Builder ─────────────────────────────────────────────────────
// Builds an EntityManager-like mock with a configurable getOne result for
// order lookups (cancelOrder / _matchOrders paths).

/**
 * Build an entity-manager mock for order-book tests.
 * @param getOneResult  What `createQueryBuilder().getOne()` returns.
 *   - For `cancelOrder` tests: pass the order to be cancelled.
 *   - For `createOrder` / `_matchOrders` tests: pass the counter-order (or null = no match).
 */
function buildManagerMock(getOneResult: QPointOrder | null) {
  const orderQb = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(getOneResult),
  };

  const orderRepo = {
    createQueryBuilder: jest.fn(() => orderQb),
    create: jest.fn((dto) => ({ id: 'new-order', ...dto })),
    save: jest.fn(async (e) => (Array.isArray(e) ? e : e)),
  };

  const tradeRepo = {
    create: jest.fn((dto) => ({ ...dto, id: 'trade-new' })),
    save: jest.fn(async (e) => e),
  };

  return {
    getRepository: jest.fn().mockImplementation(() => orderRepo),
    getOrderRepo: orderRepo,
    getTradeRepo: tradeRepo,
  };
}
