import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Entities
import { QPointOrder } from './entities/q-point-order.entity';
import { QPointTrade } from './entities/q-point-trade.entity';
import { QPointMarketBalance } from './entities/q-point-market-balance.entity';
import { QPointSettlement } from './entities/q-point-settlement.entity';
import { QPointMarketNotification } from './entities/q-point-market-notification.entity';
import { FacilitatorAccount } from './entities/facilitator-account.entity';
import { QPointsTosAcceptance } from './entities/qpoints-tos-acceptance.entity';
import { AiFacilitatorBalance } from './entities/ai-facilitator-balance.entity';
import { NettingTask } from './entities/netting-task.entity';
import { FacilitatorTransaction } from './entities/facilitator-transaction.entity';
import { WebhookEvent } from './entities/webhook-event.entity';

// Services
import { MarketBalanceService } from './services/market-balance.service';
import { PaymentFacilitatorService } from './services/payment-facilitator.service';
import { MarketNotificationService } from './services/market-notification.service';
import { SettlementService } from './services/settlement.service';
import { OrderBookService } from './services/order-book.service';
import { AiParticipantService } from './services/ai-participant.service';
import { QPointsTosService } from './services/qpoints-tos.service';
import { FacilitatorRegistryService } from './services/facilitator-registry.service';
import { CrossFacilitatorEngineService } from './services/cross-facilitator-engine.service';
import { NettingEngineService } from './services/netting-engine.service';
import { FacilitatorBalanceService } from './services/facilitator-balance.service';
import { FacilitatorTransactionService } from './services/facilitator-transaction.service';

// Guard
import { QPointsTosGuard } from './guards/qpoints-tos.guard';

// Gateway & Controller
import { QPointsMarketGateway } from './gateway/qpoints-market.gateway';
import { QPointsMarketController } from './qpoints-market.controller';
import { RevenueModule } from '@modules/revenue/revenue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      QPointOrder,
      QPointTrade,
      QPointMarketBalance,
      QPointSettlement,
      QPointMarketNotification,
      FacilitatorAccount,
      QPointsTosAcceptance,
      AiFacilitatorBalance,
      NettingTask,
      FacilitatorTransaction,
      WebhookEvent,
    ]),
    // JWT re-used for WebSocket authentication
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.secret'),
        signOptions: { expiresIn: cfg.get<string>('jwt.expiresIn') ?? '7d' },
      }),
    }),
    RevenueModule,
  ],
  controllers: [QPointsMarketController],
  providers: [
    MarketBalanceService,
    PaymentFacilitatorService,
    FacilitatorRegistryService,
    MarketNotificationService,
    SettlementService,
    CrossFacilitatorEngineService,
    NettingEngineService,
    FacilitatorBalanceService,
    FacilitatorTransactionService,
    OrderBookService,
    AiParticipantService,
    QPointsTosService,
    QPointsTosGuard,
    QPointsMarketGateway,
  ],
  exports: [TypeOrmModule, MarketBalanceService, OrderBookService, MarketNotificationService, QPointsTosService, SettlementService, FacilitatorRegistryService, PaymentFacilitatorService, CrossFacilitatorEngineService, NettingEngineService, FacilitatorBalanceService, FacilitatorTransactionService],
})
export class QPointsMarketModule {}
