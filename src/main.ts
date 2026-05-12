import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Required for Stripe webhook signature verification
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const isProduction = configService.get('NODE_ENV') === 'production';

  // Security
  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
      crossOriginEmbedderPolicy: isProduction,
    }),
  );
  app.use(compression());

  // CORS
  const corsOrigins = configService
    .get('CORS_ORIGIN')
    ?.split(',')
    .map((o: string) => o.trim());
  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : '*',
    credentials: configService.get<boolean>('cors.credentials'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    maxAge: 86400,
  });

  // Global prefix
  app.setGlobalPrefix(configService.get('API_PREFIX') || 'api');

  // API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: configService.get('API_VERSION') || 'v1',
  });

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global filters
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // Swagger documentation (disabled in production)
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('genie help Platform API')
      .setDescription('genie help — All-in-One Financial & Social Hub API')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication and authorization')
      .addTag('users', 'User management')
      .addTag('entities', 'Entity and branch management')
      .addTag('qpoints', 'Q-Points financial system')
      .addTag('subscriptions', 'Subscription management')
      .addTag('vehicles', 'Vehicle and fleet management')
      .addTag('rides', 'Ride-hailing services')
      .addTag('orders', 'Order and fulfillment')
      .addTag('products', 'Product management')
      .addTag('chat', 'Chat and messaging')
      .addTag('ai', 'AI and ML services')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger documentation enabled at /api/docs');
  }

  // Graceful shutdown
  app.enableShutdownHooks();

  // Trust proxy (behind nginx)
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  // Start server
  const port = configService.get('PORT') || 3000;
  await app.listen(port);

  logger.log(`🚀 Application running on port ${port} [${configService.get('NODE_ENV')}]`);
  logger.log(`📡 API: http://localhost:${port}/${configService.get('API_PREFIX')}`);

  if (!isProduction) {
    logger.log(`📚 Swagger: http://localhost:${port}/api/docs`);
  }
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
