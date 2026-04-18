import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RevenueModel1700002600000
 *
 * Implements the PROMPT Genie revenue model:
 *  1. Extends subscription_plans with per-staff pricing and feature flags.
 *  2. Extends subscription_assignments with free-trial tracking and staff count.
 *  3. Creates revenue_records – immutable ledger of all Q Point fees collected.
 *  4. Creates business_transaction_counters – monthly transaction count per entity.
 *
 * Revenue rules implemented:
 *  – Business subscription: pricePerStaffQPoints (default $4 = 4 QP) × staffCount / month.
 *  – First-month free trial: subscription fee waived; transaction free-quota = 0.
 *  – Transaction fee: $0.02 / tx after first 100 free per calendar month
 *    (0 free during free trial).
 *  – Trade fee: $0.02 per trade executed on the Q Points order book.
 */
export class RevenueModel1700002600000 implements MigrationInterface {
  name = 'RevenueModel1700002600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ──────────────────────────────────────────────────────────────────────
    // 1. subscription_plans – per-staff pricing & feature flags
    // ──────────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "subscription_plans"
        ADD COLUMN IF NOT EXISTS "price_per_staff_q_points"  DECIMAL(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "includes_social_features"   BOOLEAN       NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "includes_marketing_tools"   BOOLEAN       NOT NULL DEFAULT FALSE
    `);

    // Seed canonical plan data (upsert – safe to re-run)
    await queryRunner.query(`
      INSERT INTO "subscription_plans"
        ("name", "description",
         "price_per_staff_q_points", "monthly_cost_q_points",
         "includes_social_features", "includes_marketing_tools",
         "booster_points_allocation", "is_active")
      VALUES
        ('Free',         'Free tier – core tools, no charge',                     0,  0,  FALSE, FALSE, 0,   TRUE),
        ('Basic',        'Core business management tools ($4 QP/staff/month)',     4,  0,  FALSE, FALSE, 50,  TRUE),
        ('Professional', 'Basic + social features ($8 QP/staff/month)',            8,  0,  TRUE,  FALSE, 100, TRUE),
        ('Enterprise',   'Full platform: social + marketing ($12 QP/staff/month)',12,  0,  TRUE,  TRUE,  200, TRUE)
      ON CONFLICT ("name") DO UPDATE
        SET "price_per_staff_q_points"  = EXCLUDED."price_per_staff_q_points",
            "includes_social_features"  = EXCLUDED."includes_social_features",
            "includes_marketing_tools"  = EXCLUDED."includes_marketing_tools",
            "description"               = EXCLUDED."description",
            "booster_points_allocation" = EXCLUDED."booster_points_allocation"
    `);

    // ──────────────────────────────────────────────────────────────────────
    // 2. subscription_assignments – free-trial & staff count
    // ──────────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "subscription_assignments"
        ADD COLUMN IF NOT EXISTS "staff_count"        INTEGER     NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "is_in_free_trial"   BOOLEAN     NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "free_trial_ends_at" TIMESTAMPTZ
    `);

    // ──────────────────────────────────────────────────────────────────────
    // 3. revenue_records
    // ──────────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "revenue_type_enum" AS ENUM (
        'subscription', 'transaction_fee', 'trade_fee'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "revenue_records" (
        "id"               UUID                    NOT NULL DEFAULT gen_random_uuid(),
        "type"             "revenue_type_enum"     NOT NULL,
        "amount_q_points"  DECIMAL(12,4)           NOT NULL,
        "entity_id"        UUID,
        "user_id"          UUID,
        "ref_id"           VARCHAR(100),
        "metadata"         JSONB,
        "created_at"       TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
        "updated_at"       TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
        "deleted_at"       TIMESTAMPTZ,
        CONSTRAINT "pk_revenue_records" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_revenue_records_type"       ON "revenue_records" ("type")`);
    await queryRunner.query(`CREATE INDEX "idx_revenue_records_entity_id"  ON "revenue_records" ("entity_id")`);
    await queryRunner.query(`CREATE INDEX "idx_revenue_records_user_id"    ON "revenue_records" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_revenue_records_created_at" ON "revenue_records" ("created_at")`);

    // ──────────────────────────────────────────────────────────────────────
    // 4. business_transaction_counters
    // ──────────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_transaction_counters" (
        "id"                   UUID          NOT NULL DEFAULT gen_random_uuid(),
        "entity_id"            UUID          NOT NULL,
        "calendar_month"       VARCHAR(7)    NOT NULL,
        "transaction_count"    INTEGER       NOT NULL DEFAULT 0,
        "total_fees_q_points"  DECIMAL(12,4) NOT NULL DEFAULT 0,
        "free_quota"           INTEGER       NOT NULL DEFAULT 100,
        "created_at"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "updated_at"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "deleted_at"           TIMESTAMPTZ,
        CONSTRAINT "pk_business_transaction_counters" PRIMARY KEY ("id"),
        CONSTRAINT "uq_btc_entity_month" UNIQUE ("entity_id", "calendar_month")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_btc_entity_id" ON "business_transaction_counters" ("entity_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop new tables
    await queryRunner.query(`DROP TABLE IF EXISTS "business_transaction_counters"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "revenue_records"`);
    await queryRunner.query(`DROP TYPE  IF EXISTS "revenue_type_enum"`);

    // Remove added columns
    await queryRunner.query(`
      ALTER TABLE "subscription_assignments"
        DROP COLUMN IF EXISTS "free_trial_ends_at",
        DROP COLUMN IF EXISTS "is_in_free_trial",
        DROP COLUMN IF EXISTS "staff_count"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscription_plans"
        DROP COLUMN IF EXISTS "includes_marketing_tools",
        DROP COLUMN IF EXISTS "includes_social_features",
        DROP COLUMN IF EXISTS "price_per_staff_q_points"
    `);
  }
}
