import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { WinstonModule } from 'nest-winston';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import * as winston from 'winston';

// Configuration
import { configuration } from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { typeOrmConfig } from './config/typeorm.config';

// Common modules
import { CommonModule } from './common/common.module';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { UsersModule } from './modules/users/users.module';
import { EntitiesModule } from './modules/entities/entities.module';
import { QPointsModule } from './modules/qpoints/qpoints.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { EntityProfilesModule } from './modules/entity-profiles/entity-profiles.module';
import { MarketProfilesModule } from './modules/market-profiles/market-profiles.module';
import { InterestsModule } from './modules/interests/interests.module';
import { PlacesModule } from './modules/places/places.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { FavoriteDriversModule } from './modules/favorite-drivers/favorite-drivers.module';
import { ProductsModule } from './modules/products/products.module';
import { SocialModule } from './modules/social/social.module';
import { OrdersModule } from './modules/orders/orders.module';
import { RidesModule } from './modules/rides/rides.module';
import { AIModule } from './modules/ai/ai.module';
import { HealthModule } from './modules/health/health.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { PlannerModule } from './modules/planner/planner.module';
import { StatementModule } from './modules/statement/statement.module';
import { WishlistModule } from './modules/wishlist/wishlist.module';
import { GatewayModule } from './gateway/gateway.module';
import { FilesModule } from './modules/files/files.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { GoModule } from './modules/go/go.module';
import { QPointsMarketModule } from './modules/qpoints/market/qpoints-market.module';
import { RevenueModule } from './modules/revenue/revenue.module';
import { EplayModule } from './modules/eplay/eplay.module';
import { CommunityModule } from './modules/community/community.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      cache: true,
    }),

    // Database
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => typeOrmConfig(configService),
    }),

    // Rate Limiting (defense-in-depth alongside nginx)
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get<number>('throttle.ttl') ?? 60,
          limit: configService.get<number>('throttle.limit') ?? 100,
        },
      ],
    }),

    // Queue
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          password: configService.get<string>('redis.password') || undefined,
          db: configService.get<number>('redis.db'),
        },
      }),
    }),

    // Scheduler
    ScheduleModule.forRoot(),

    // Logger
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        transports: [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.colorize(),
              winston.format.printf(({ timestamp, level, message, context, trace }) => {
                return `${timestamp} [${context}] ${level}: ${message}${trace ? `\n${trace}` : ''}`;
              }),
            ),
          }),
          new winston.transports.File({
            filename: `${configService.get<string>('logging.filePath') ?? './logs'}/error.log`,
            level: 'error',
            format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
          }),
          new winston.transports.File({
            filename: `${configService.get<string>('logging.filePath') ?? './logs'}/combined.log`,
            format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
          }),
        ],
      }),
    }),

    // Common
    CommonModule,
    GatewayModule,
    FilesModule,

    // Feature modules
    HealthModule,
    AuthModule,
    UsersModule,
    EntitiesModule,
    QPointsModule,
    ProfilesModule,
    EntityProfilesModule,
    MarketProfilesModule,
    InterestsModule,
    PlacesModule,
    VehiclesModule,
    FavoriteDriversModule,
    ProductsModule,
    SocialModule,
    OrdersModule,
    RidesModule,
    AIModule,
    SubscriptionsModule,
    CalendarModule,
    PlannerModule,
    StatementModule,
    WishlistModule,
    WalletsModule,
    PaymentsModule,
    GoModule,
    QPointsMarketModule,
    RevenueModule,
    EplayModule,
    CommunityModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
