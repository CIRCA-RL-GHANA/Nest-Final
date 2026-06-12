import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';

const logger = new Logger('TypeOrmConfig');

export const typeOrmConfig = (configService: ConfigService): TypeOrmModuleOptions => {
  const isProduction = configService.get('NODE_ENV') === 'production';

  const poolMax = parseInt(process.env.DB_POOL_MAX ?? '20', 10);
  const poolMin = parseInt(process.env.DB_POOL_MIN ?? '5', 10);

  const base: Partial<TypeOrmModuleOptions> = {
    type: 'postgres',
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
    synchronize: configService.get('database.synchronize'),
    logging: configService.get('database.logging'),
    extra: {
      max: poolMax,
      min: poolMin,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    },
  };

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return { ...base, url: databaseUrl, ssl: { rejectUnauthorized: false } } as TypeOrmModuleOptions;
  }

  const sslEnabled = configService.get<boolean>('database.ssl');
  if (isProduction && !sslEnabled) {
    logger.warn(
      'DB_SSL is not enabled in production. Database traffic is unencrypted. ' +
      'Set DB_SSL=true to enforce TLS.',
    );
  }

  return {
    ...base,
    host: configService.get('database.host'),
    port: configService.get('database.port'),
    username: configService.get('database.username'),
    password: configService.get('database.password'),
    database: configService.get('database.name'),
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
  } as TypeOrmModuleOptions;
};
