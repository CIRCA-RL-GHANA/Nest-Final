# Backend — orionstack-backend--main

NestJS 10 REST API and WebSocket server for the genie help platform.

## Overview

| Property | Value |
|---|---|
| Framework | NestJS 10 |
| Language | TypeScript 5 |
| Runtime | Node.js 18 |
| Database | PostgreSQL 15 via TypeORM 0.3 |
| Cache / Queues | Redis 7 via Bull |
| Real-time | Socket.io (NestJS Gateways) |
| Docs (dev) | Swagger at `/api/docs` |
| Base URL | `/api/v1/` |

## Directory Structure

```
orionstack-backend--main/
├── src/
│   ├── main.ts                   ← Bootstrap: Helmet, CORS, Swagger, global pipes/filters
│   ├── app.module.ts             ← Root module — registers every feature module
│   ├── app.service.ts
│   ├── config/
│   │   ├── configuration.ts      ← All env-var config (source of truth)
│   │   ├── typeorm.config.ts     ← TypeORM DataSource config for CLI migrations
│   │   └── validation.schema.ts  ← Joi env-var validation schema
│   ├── database/
│   │   ├── data-source.ts        ← DataSource for TypeORM CLI
│   │   ├── migrations/           ← TypeORM migration files
│   │   └── seeds/                ← Data seed scripts
│   ├── common/
│   │   ├── constants/            ← Shared backend constants
│   │   ├── dto/                  ← Common DTOs (pagination, etc.)
│   │   ├── entities/base.entity.ts ← UUID PK, timestamps, soft-delete
│   │   ├── exceptions/           ← Custom exception classes
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts ← Global error response formatter
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts   ← Winston request/response logging
│   │   │   └── transform.interceptor.ts ← Wraps responses in envelope
│   │   └── services/
│   │       └── email.service.ts  ← SendGrid email sending
│   ├── gateway/
│   │   ├── chat.gateway.ts       ← Socket.io WebSocket gateway
│   │   └── gateway.module.ts
│   └── modules/
│       ├── auth/                 ← JWT auth, OTP, biometric, guards, strategies
│       ├── users/                ← User entity, OTP entity, staff, audit log
│       ├── profiles/
│       ├── entities/             ← Business entity management
│       ├── entity-profiles/
│       ├── market-profiles/
│       ├── qpoints/              ← Loyalty points system
│       ├── wallets/
│       ├── payments/
│       ├── go/                   ← GO financial wallet
│       ├── products/
│       ├── orders/
│       ├── rides/
│       ├── vehicles/
│       ├── favorite-drivers/
│       ├── social/               ← Hey-Ya, chat, posts, engagements
│       ├── interests/
│       ├── subscriptions/
│       ├── ai/                   ← NLP, pricing, fraud, insights, recommendations
│       ├── places/
│       ├── calendar/
│       ├── planner/
│       ├── statement/
│       ├── wishlist/
│       ├── health/               ← Terminus health checks
│       └── files/
├── Dockerfile                    ← Multi-stage builder (Node 18) → production image
├── docker-compose.yml            ← Development: postgres + redis + app
├── nest-cli.json
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

## Local Development Setup

### Prerequisites

- Node.js 18+
- Docker and Docker Compose
- npm 9+

### 1. Install dependencies

```bash
cd orionstack-backend--main
npm install
```

### 2. Start backing services

```bash
# From the monorepo root:
docker compose -f orionstack-backend--main/docker-compose.yml up -d postgres redis
```

Or from within the backend directory:
```bash
docker compose up -d postgres redis
```

### 3. Configure environment

Create `.env` in the **monorepo root** (the backend reads from there via Docker, or locally reads the process environment). For local-only dev, you can create a `.env` in `orionstack-backend--main/` as well:

```
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=promptgenie_dev
DB_SYNCHRONIZE=false
JWT_SECRET=dev_jwt_secret_change_in_prod
JWT_REFRESH_SECRET=dev_refresh_secret_change_in_prod
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 4. Run migrations

```bash
npm run migration:run
```

### 5. Start the server

```bash
npm run start:dev
```

The API will be available at `http://localhost:3000/api/v1/`.  
Swagger UI: `http://localhost:3000/api/docs`

## npm Scripts

| Script | Description |
|---|---|
| `start:dev` | Start with ts-jest watch + hot reload |
| `start:debug` | Start with Node inspector attached |
| `start:prod` | Start compiled `dist/main.js` |
| `build` | Compile TypeScript to `dist/` |
| `test` | Run Jest unit tests |
| `test:e2e` | Run end-to-end tests |
| `test:cov` | Test with coverage report |
| `lint` | ESLint with auto-fix |
| `migration:generate -- --name=<Name>` | Generate a migration from entity diff |
| `migration:run` | Apply pending migrations |
| `migration:revert` | Revert the last migration |
| `seed` | Run database seed scripts |

## Architecture

### Request Lifecycle

```
Client → Nginx (TLS + rate-limit) → NestJS
  → Helmet (security headers)
  → CORS check
  → JWT Guard (global)         ← all routes protected by default
  → ValidationPipe (whitelist + transform)
  → Controller
  → Service
  → TypeORM / Redis / External APIs
  → TransformInterceptor        ← wraps response in envelope
  → LoggingInterceptor          ← logs request duration
  → HttpExceptionFilter         ← formats errors
```

### Authentication

Authentication is handled globally:

- `APP_GUARD` is set to `JwtAuthGuard` — every route is protected by default
- Routes opt out of auth using the `@Public()` decorator
- JWT strategy validates `Authorization: Bearer <token>` via `passport-jwt`
- Login accepts `phoneNumber` or `socialUsername` + password
- A valid OTP verification (`otpVerified = true`) is required before login is permitted
- Refresh tokens are signed with a separate `JWT_REFRESH_SECRET`

### Database

- **PostgreSQL 15** via TypeORM 0.3
- `BaseEntity` (`common/entities/base.entity.ts`): all entities extend this, providing UUID primary key, `createdAt`, `updatedAt`, `deletedAt` (soft delete via `@DeleteDateColumn`)
- Connection pool: max 20, min 5, 30 second idle timeout
- `DB_SYNCHRONIZE` is always `false` in production — use migrations
- Run migrations with `npm run migration:run` or `make migrate-prod`

### AI Services

All AI runs in pure TypeScript (no Python microservice dependency):

| Service | Library | Capability |
|---|---|---|
| `ai-nlp.service.ts` | `natural`, `compromise` | Sentiment (AFINN), intent (11 categories), TF-IDF search, NER, keyword extraction, summarisation, cosine similarity |
| `ai-pricing.service.ts` | Pure math | Surge pricing (max 3.5×), peak-hour rules (7–9am, 5–8pm, late night, weekends), fare breakdown with 8% platform fee |
| `ai-fraud.service.ts` | Pure math | Velocity check (>10 tx/hr), amount anomaly (>5× historic avg), geolocation anomaly; auto-block at score ≥0.85, flag-review at ≥0.55 |
| `ai-insights.service.ts` | Pure analytics | Financial, behavioural, ride insights |
| `ai-recommendations.service.ts` | Collaborative filtering | Product / entity recommendations |
| `ai-search.service.ts` | TF-IDF | Cross-entity search |

TensorFlow.js is optional (`TENSORFLOW_ENABLED=true`) and loads models from `./ml-models`.

### Real-time (WebSocket)

`chat.gateway.ts` implements a Socket.io namespace at `/`. Authentication is required via a `token` in the Socket.io handshake `auth` object. The gateway manages conversation rooms, presence tracking, and message delivery.

### Queues (Bull / Redis)

Background jobs are dispatched through Bull queues backed by Redis. Used for deferred tasks such as notification delivery and batch analytics.

### Logging

Winston is configured with two transports:
1. Console (coloured, for development)
2. File (JSON format, written to `./logs/`)

The `LoggingInterceptor` logs every request with method, path, status code, and duration.

## Docker

### Development (`docker-compose.yml`)

```bash
docker compose up        # Starts postgres, redis, and the app
docker compose up -d     # Detached
docker compose logs -f app
```

Services:
- `postgres` — port 5432 (localhost)
- `redis` — port 6379 (localhost)
- `app` — port 3000 (built from `Dockerfile`, target `production`)

### Production Image (`Dockerfile`)

Multi-stage build:
1. **builder** stage: `node:18-alpine`, installs all deps, compiles TypeScript
2. **production** stage: copies only `dist/` and production `node_modules`, runs as non-root user `nestjs:nodejs`, healthcheck at `/api/v1/health/live`, `EXPOSE 3000`

```bash
docker build -t promptgenie-app .
docker run -p 3000:3000 --env-file ../.env promptgenie-app
```

## Database Migrations

Migrations live in `src/database/migrations/`. Never use `DB_SYNCHRONIZE=true` in production.

```bash
# Generate a migration from recent entity changes
npm run migration:generate -- --name=AddUserPreferences

# Apply all pending migrations
npm run migration:run

# Revert the last migration
npm run migration:revert
```

The TypeORM CLI config is in `src/config/typeorm.config.ts` and `src/database/data-source.ts`.

## Health Checks

Three endpoints are available for uptime monitoring and container orchestration:

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/health` | Full health (DB + Redis + disk) |
| `GET /api/v1/health/ready` | Readiness probe (all deps healthy) |
| `GET /api/v1/health/live` | Liveness probe (process alive) |

All three are `@Public()` and return `200 OK` or `503 Service Unavailable`.

## Swagger

In `NODE_ENV=development`, Swagger UI is available at `http://localhost:3000/api/docs`.  
In production, `/api/docs` returns `404` (blocked by Nginx).

## Security

- `helmet` sets secure HTTP headers on every response
- `ValidationPipe` with `whitelist: true` strips unknown properties from all request bodies
- Passwords are hashed with bcrypt (12 rounds by default)
- `passwordHash` is excluded from query results via `@Column({ select: false })`
- Rate limiting is enforced both at the NestJS application layer (`ThrottlerModule`) and by Nginx
- CORS origin is explicitly configured via `CORS_ORIGIN` — default `*` must be changed in production
