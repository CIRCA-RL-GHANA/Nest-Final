import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnterpriseExtension1720100000000 implements MigrationInterface {
  name = 'EnterpriseExtension1720100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── institution_tier enum ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE institution_tier_enum AS ENUM ('standard', 'premium', 'sovereign')
    `);

    // ─── institution_configs ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS institution_configs (
        id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        entity_id       UUID        NOT NULL UNIQUE,
        tier            institution_tier_enum NOT NULL DEFAULT 'standard',
        issue_cap       BIGINT      NOT NULL DEFAULT 0,
        minted_supply   BIGINT      NOT NULL DEFAULT 0,
        facility_fee_rate DECIMAL(6,5) NOT NULL DEFAULT 0.001,
        is_active       BOOLEAN     NOT NULL DEFAULT FALSE,
        due_diligence_cleared BOOLEAN NOT NULL DEFAULT FALSE,
        last_settlement_at TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_institution_configs_entity_id ON institution_configs (entity_id)
    `);

    // ─── webhook_subscriptions ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        entity_id      UUID        NOT NULL,
        url            TEXT        NOT NULL,
        secret_hash    TEXT        NOT NULL,
        secret_prefix  VARCHAR(8)  NOT NULL,
        events         JSONB       NOT NULL DEFAULT '[]',
        is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
        delivery_count INT         NOT NULL DEFAULT 0,
        failure_count  INT         NOT NULL DEFAULT 0,
        last_delivered_at TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_webhook_subs_entity_id ON webhook_subscriptions (entity_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_webhook_subs_entity_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_subscriptions`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_institution_configs_entity_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS institution_configs`);

    await queryRunner.query(`DROP TYPE IF EXISTS institution_tier_enum`);
  }
}
