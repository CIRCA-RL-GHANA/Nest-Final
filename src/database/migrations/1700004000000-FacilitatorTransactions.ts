import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: On-Ramp / Off-Ramp — Facilitator Transactions
 *
 * Adds:
 *   1. `facilitator_transactions` table — tracks every deposit/withdrawal
 *   2. `webhook_events` table — idempotency log for incoming webhooks
 *   3. `default_payout_method_id` column on `facilitator_accounts` — stores
 *      the user's preferred payout destination (bank account, recipient code)
 */
export class FacilitatorTransactions1700004000000 implements MigrationInterface {
  name = 'FacilitatorTransactions1700004000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS facilitator_transaction_type AS ENUM ('deposit', 'withdraw')
    `);

    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS facilitator_transaction_status AS ENUM (
        'pending', 'processing', 'completed', 'failed', 'cancelled'
      )
    `);

    // ── facilitator_transactions ──────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE facilitator_transactions (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           UUID NOT NULL,
        provider          VARCHAR(32) NOT NULL,
        type              facilitator_transaction_type NOT NULL,
        amount            DECIMAL(12, 2) NOT NULL,
        currency          VARCHAR(10) NOT NULL DEFAULT 'USD',
        status            facilitator_transaction_status NOT NULL DEFAULT 'pending',
        external_id       VARCHAR(255),
        idempotency_key   VARCHAR(255) NOT NULL UNIQUE,
        checkout_url      VARCHAR(1024),
        error_message     TEXT,
        completed_at      TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_ft_user_id ON facilitator_transactions (user_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_ft_external_id ON facilitator_transactions (external_id)
      WHERE external_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_ft_user_type_created
        ON facilitator_transactions (user_id, type, created_at DESC)
    `);

    // ── webhook_events ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE webhook_events (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id     VARCHAR(255) NOT NULL,
        provider     VARCHAR(64) NOT NULL,
        event_type   VARCHAR(128) NOT NULL,
        payload      JSONB,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_webhook_event_id UNIQUE (event_id)
      )
    `);

    // ── Extend facilitator_accounts ───────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE facilitator_accounts
        ADD COLUMN IF NOT EXISTS default_payout_method_id VARCHAR(255)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE facilitator_accounts DROP COLUMN IF EXISTS default_payout_method_id
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_events`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ft_user_type_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ft_external_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ft_user_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS facilitator_transactions`);
    await queryRunner.query(`DROP TYPE IF EXISTS facilitator_transaction_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS facilitator_transaction_type`);
  }
}
