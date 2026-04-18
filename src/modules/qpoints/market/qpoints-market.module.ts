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

// Services
import { MarketBalanceService } from './services/market-balance.service';
import { PaymentFacilitatorService } from './services/payment-facilitator.service';
import { MarketNotificationService } from './services/market-notification.service';
import { SettlementService } from './services/settlement.service';
import { OrderBookService } from './services/order-book.service';
import { AiLiquidityManagerService } from './services/ai-liquidity-manager.service';

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
    MarketNotificationService,
    SettlementService,
    OrderBookService,
    AiLiquidityManagerService,
    QPointsMarketGateway,
  ],
  exports: [TypeOrmModule, MarketBalanceService, OrderBookService, MarketNotificationService],
})
export class QPointsMarketModule {}
