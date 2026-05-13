/// <reference path="../../../../types/jest-global.d.ts" />
import { SettlementService } from './settlement.service';
import {
  QPointSettlement,
  SettlementStatus,
  SettlementType,
} from '../entities/q-point-settlement.entity';
import { QPointTrade } from '../entities/q-point-trade.entity';
import { MarketNotificationService } from './market-notification.service';

function makeTrade(overrides: Partial<QPointTrade> = {}): QPointTrade {
  return {
    id: 'trade-xyz',
    buyOrderId: 'order-buy',
    sellOrderId: 'order-sell',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    price: 1.0,
    quantity: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null as unknown as Date,
    ...overrides,
  } as QPointTrade;
}

describe('SettlementService', () => {
  let service: SettlementService;
  let mockRepo: {
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let mockNotifications: { notifyUser: jest.Mock };

  beforeEach(() => {
    mockRepo = {
      create: jest.fn((dto) => ({ ...dto, id: `settlement-${Math.random()}` })),
      save: jest.fn(async (items: unknown) =>
        Array.isArray(items) ? items.map((item, i) => ({ ...item, id: `settlement-${i}` })) : items,
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };

    mockNotifications = { notifyUser: jest.fn().mockResolvedValue(undefined) };

    service = new SettlementService(
      mockRepo as never,
      mockNotifications as unknown as MarketNotificationService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ─── createSettlement ────────────────────────────────────────────────────
  // Per Q Points ToS §4.3, the Platform never initiates fiat transfers; it
  // only records PENDING audit entries and notifies both parties.

  describe('createSettlement', () => {
    it('creates a PENDING debit + credit record for the trade', async () => {
      const trade = makeTrade();
      await service.createSettlement(trade, 'buyer-1', 'seller-1', 100.0);

      expect(mockRepo.create).toHaveBeenCalledTimes(2);
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            type: SettlementType.DEBIT,
            status: SettlementStatus.PENDING,
            userId: 'buyer-1',
            amount: 100.0,
            tradeId: trade.id,
          }),
          expect.objectContaining({
            type: SettlementType.CREDIT,
            status: SettlementStatus.PENDING,
            userId: 'seller-1',
            amount: 100.0,
            tradeId: trade.id,
          }),
        ]),
      );
    });

    it('notifies both buyer and seller with settlement_pending', async () => {
      const trade = makeTrade();
      await service.createSettlement(trade, 'buyer-abc', 'seller-xyz', 50.0);

      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'buyer-abc',
        'settlement_pending',
        expect.any(String),
        expect.objectContaining({ tradeId: trade.id, amount: 50.0 }),
      );
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'seller-xyz',
        'settlement_pending',
        expect.any(String),
        expect.objectContaining({ tradeId: trade.id, amount: 50.0 }),
      );
    });

    it('does NOT update existing settlement records (Platform records only, never moves fiat)', async () => {
      const trade = makeTrade();
      await service.createSettlement(trade, 'buyer-1', 'seller-1', 100.0);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });

  // ─── confirmSettlementByWebhook ──────────────────────────────────────────

  describe('confirmSettlementByWebhook', () => {
    it('marks all settlement records for a trade as COMPLETED with facilitator reference', async () => {
      const records: QPointSettlement[] = [
        { id: 'settlement-a' } as QPointSettlement,
        { id: 'settlement-b' } as QPointSettlement,
      ];
      mockRepo.find.mockResolvedValue(records);

      await service.confirmSettlementByWebhook('trade-xyz', 'ref-123');

      expect(mockRepo.update).toHaveBeenCalledTimes(2);
      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'settlement-a' },
        expect.objectContaining({
          status: SettlementStatus.COMPLETED,
          facilitatorReference: 'ref-123',
        }),
      );
      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'settlement-b' },
        expect.objectContaining({
          status: SettlementStatus.COMPLETED,
          facilitatorReference: 'ref-123',
        }),
      );
    });

    it('returns silently when no records exist for the trade', async () => {
      mockRepo.find.mockResolvedValue([]);
      await expect(
        service.confirmSettlementByWebhook('missing-trade', 'ref-1'),
      ).resolves.toBeUndefined();
      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });

  // ─── getSettlementStatus ─────────────────────────────────────────────────

  describe('getSettlementStatus', () => {
    it('returns the settlement record when it exists', async () => {
      const s = {
        id: 'settlement-1',
        status: SettlementStatus.COMPLETED,
      } as QPointSettlement;
      mockRepo.findOne.mockResolvedValue(s);

      const result = await service.getSettlementStatus('settlement-1');

      expect(result).toBe(s);
    });

    it('throws when the settlement is not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.getSettlementStatus('nonexistent')).rejects.toThrow();
    });
  });
});
