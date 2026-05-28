import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const typeOrmConfig = (configService: ConfigService): TypeOrmModuleOptions => {
  const base: Partial<TypeOrmModuleOptions> = {
    type: 'postgres',
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
    synchronize: configService.get('database.synchronize'),
    logging: configService.get('database.logging'),
    extra: {
      max: 20,
      min: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    },
  };

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return { ...base, url: databaseUrl, ssl: { rejectUnauthorized: false } } as TypeOrmModuleOptions;
  }

  return {
    ...base,
    host: configService.get('database.host'),
    port: configService.get('database.port'),
    username: configService.get('database.username'),
    password: configService.get('database.password'),
    database: configService.get('database.name'),
    ssl: configService.get('database.ssl') ? { rejectUnauthorized: false } : false,
  } as TypeOrmModuleOptions;
};
