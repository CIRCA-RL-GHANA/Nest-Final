import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentsService } from './payments.service';
import { Payment } from '../entities/payment.entity';
import { WalletsService } from '../wallets/wallets.service';
import { AIFraudService } from '../ai/services/ai-fraud.service';
import { QPointsTransactionService } from '../qpoints/qpoints-transaction.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() },
        },
        { provide: WalletsService, useValue: { deductBalance: jest.fn(), addBalance: jest.fn() } },
        {
          provide: AIFraudService,
          useValue: {
            scoreTransaction: jest
              .fn()
              .mockReturnValue({ blocked: false, riskScore: 0, reviewFlag: false }),
          },
        },
        {
          provide: QPointsTransactionService,
          useValue: {
            getAccountByUserId: jest.fn().mockResolvedValue({ id: 'acc-user' }),
            getAccountByEntityId: jest.fn().mockResolvedValue({ id: 'acc-merchant' }),
            transfer: jest.fn().mockResolvedValue({ id: 'tx-1' }),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
