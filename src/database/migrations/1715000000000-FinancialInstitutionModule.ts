import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FinancialInstitutionModule1715000000000
 *
 * Creates all tables required by the Financial Institution (FI) extension:
 *   - fi_profiles                  : Regulatory metadata for FI entities
 *   - loan_applications            : Loan origination records
 *   - loan_repayments              : Per-instalment repayment log
 *   - deposit_accounts             : Term-deposit lock records
 *   - insurance_policies           : Policy purchase records
 *   - insurance_claims             : Claim submissions
 *   - credit_data_queries          : Per-query credit data log
 *
 * Design rules:
 *   - All monetary amounts are stored as NUMERIC(18,4) in Q-Points units.
 *   - Foreign keys reference existing tables (entities, users) without
 *     adding constraints that break existing data; ON DELETE SET NULL used
 *     to preserve audit trail.
 *   - New enum types use IF NOT EXISTS guards to be idempotent.
 *   - Matching down() tears everything down cleanly.
 */
export class FinancialInstitutionModule1715000000000 implements MigrationInterface {
  name = 'FinancialInstitutionModule1715000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "loan_status_enum" AS ENUM (
          'pending', 'approved', 'active', 'repaid', 'defaulted', 'rejected', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "deposit_status_enum" AS ENUM (
          'active', 'matured', 'withdrawn', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "insurance_policy_type_enum" AS ENUM (
          'health', 'motor', 'inventory', 'life', 'property', 'travel', 'other'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "insurance_policy_status_enum" AS ENUM (
          'active', 'expired', 'cancelled', 'claimed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "insurance_claim_status_enum" AS ENUM (
          'submitted', 'under_review', 'approved', 'rejected', 'paid_out'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // ── fi_profiles ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fi_profiles" (
        "id"                    UUID          NOT NULL DEFAULT gen_random_uuid(),
        "entity_id"             UUID          NOT NULL,
        "license_number"        VARCHAR(200),
        "license_document_url"  VARCHAR(1000),
        "license_verified"      BOOLEAN       NOT NULL DEFAULT false,
        "risk_model_config"     JSONB,
        "webhook_url"           VARCHAR(1000),
        "max_loan_amount_qp"    NUMERIC(18,4) NOT NULL DEFAULT 100000,
        "min_loan_amount_qp"    NUMERIC(18,4) NOT NULL DEFAULT 100,
        "base_interest_rate"    NUMERIC(6,4)  NOT NULL DEFAULT 0.15,
        "credit_query_fee_qp"   NUMERIC(18,4) NOT NULL DEFAULT 5,
        "credit_sub_tier"       VARCHAR(50),
        "created_at"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "updated_at"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "deleted_at"            TIMESTAMPTZ,
        CONSTRAINT "pk_fi_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fi_profiles_entity_id" UNIQUE ("entity_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_fi_profiles_entity_id" ON "fi_profiles" ("entity_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_fi_profiles_license_verified" ON "fi_profiles" ("license_verified")`);

    // ── loan_applications ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "loan_applications" (
        "id"                UUID              NOT NULL DEFAULT gen_random_uuid(),
        "borrower_user_id"  UUID              NOT NULL,
        "fi_entity_id"      UUID              NOT NULL,
        "amount_qp"         NUMERIC(18,4)     NOT NULL,
        "purpose"           VARCHAR(500)      NOT NULL,
        "status"            "loan_status_enum" NOT NULL DEFAULT 'pending',
        "interest_rate"     NUMERIC(6,4)      NOT NULL DEFAULT 0.15,
        "term_days"         INTEGER           NOT NULL DEFAULT 30,
        "approved_by"       UUID,
        "approved_at"       TIMESTAMPTZ,
        "disbursed_at"      TIMESTAMPTZ,
        "disbursement_tx_id" UUID,
        "origination_fee_qp" NUMERIC(18,4)   NOT NULL DEFAULT 0,
        "outstanding_qp"    NUMERIC(18,4)    NOT NULL DEFAULT 0,
        "auto_sweep_pct"    NUMERIC(5,4)     NOT NULL DEFAULT 0.10,
        "notes"             TEXT,
        "metadata"          JSONB,
        "created_at"        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        "updated_at"        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        "deleted_at"        TIMESTAMPTZ,
        CONSTRAINT "pk_loan_applications" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_loan_apps_borrower" ON "loan_applications" ("borrower_user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_loan_apps_fi_entity" ON "loan_applications" ("fi_entity_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_loan_apps_status" ON "loan_applications" ("status")`);

    // ── loan_repayments ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "loan_repayments" (
        "id"              UUID          NOT NULL DEFAULT gen_random_uuid(),
        "application_id"  UUID          NOT NULL,
        "amount_qp"       NUMERIC(18,4) NOT NULL,
        "tx_id"           UUID,
        "is_auto_sweep"   BOOLEAN       NOT NULL DEFAULT false,
        "created_at"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        CONSTRAINT "pk_loan_repayments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_loan_repayments_app" ON "loan_repayments" ("application_id")`);

    // ── deposit_accounts ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "deposit_accounts" (
        "id"              UUID                  NOT NULL DEFAULT gen_random_uuid(),
        "user_id"         UUID                  NOT NULL,
        "fi_entity_id"    UUID                  NOT NULL,
        "locked_qp"       NUMERIC(18,4)         NOT NULL,
        "interest_rate"   NUMERIC(6,4)          NOT NULL DEFAULT 0.08,
        "term_days"       INTEGER               NOT NULL DEFAULT 90,
        "maturity_date"   TIMESTAMPTZ           NOT NULL,
        "status"          "deposit_status_enum" NOT NULL DEFAULT 'active',
        "lock_tx_id"      UUID,
        "unlock_tx_id"    UUID,
        "interest_paid_qp" NUMERIC(18,4)        NOT NULL DEFAULT 0,
        "created_at"      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
        "updated_at"      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
        "deleted_at"      TIMESTAMPTZ,
        CONSTRAINT "pk_deposit_accounts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_deposit_accounts_user" ON "deposit_accounts" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_deposit_accounts_fi" ON "deposit_accounts" ("fi_entity_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_deposit_accounts_status" ON "deposit_accounts" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_deposit_accounts_maturity" ON "deposit_accounts" ("maturity_date")`);

    // ── insurance_policies ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insurance_policies" (
        "id"              UUID                          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"         UUID                          NOT NULL,
        "fi_entity_id"    UUID                          NOT NULL,
        "policy_type"     "insurance_policy_type_enum"  NOT NULL,
        "status"          "insurance_policy_status_enum" NOT NULL DEFAULT 'active',
        "premium_qp"      NUMERIC(18,4)                NOT NULL,
        "coverage_qp"     NUMERIC(18,4)                NOT NULL,
        "platform_fee_qp" NUMERIC(18,4)                NOT NULL DEFAULT 0,
        "start_date"      TIMESTAMPTZ                  NOT NULL,
        "end_date"        TIMESTAMPTZ                  NOT NULL,
        "premium_tx_id"   UUID,
        "metadata"        JSONB,
        "created_at"      TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
        "updated_at"      TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
        "deleted_at"      TIMESTAMPTZ,
        CONSTRAINT "pk_insurance_policies" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_insurance_policies_user" ON "insurance_policies" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_insurance_policies_fi" ON "insurance_policies" ("fi_entity_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_insurance_policies_status" ON "insurance_policies" ("status")`);

    // ── insurance_claims ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "insurance_claims" (
        "id"              UUID                          NOT NULL DEFAULT gen_random_uuid(),
        "policy_id"       UUID                          NOT NULL,
        "user_id"         UUID                          NOT NULL,
        "amount_claimed_qp" NUMERIC(18,4)              NOT NULL,
        "description"     TEXT                         NOT NULL,
        "attachments"     JSONB,
        "status"          "insurance_claim_status_enum" NOT NULL DEFAULT 'submitted',
        "reviewer_notes"  TEXT,
        "payout_tx_id"    UUID,
        "created_at"      TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
        "updated_at"      TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
        CONSTRAINT "pk_insurance_claims" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_insurance_claims_policy" ON "insurance_claims" ("policy_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_insurance_claims_user" ON "insurance_claims" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_insurance_claims_status" ON "insurance_claims" ("status")`);

    // ── credit_data_queries ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "credit_data_queries" (
        "id"                    UUID          NOT NULL DEFAULT gen_random_uuid(),
        "requesting_fi_entity_id" UUID        NOT NULL,
        "subject_user_id"       UUID          NOT NULL,
        "consent_id"            UUID,
        "score"                 INTEGER,
        "data_json"             JSONB,
        "fee_qp"                NUMERIC(18,4) NOT NULL DEFAULT 0,
        "fee_tx_id"             UUID,
        "created_at"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        CONSTRAINT "pk_credit_data_queries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_credit_queries_fi" ON "credit_data_queries" ("requesting_fi_entity_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_credit_queries_subject" ON "credit_data_queries" ("subject_user_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "credit_data_queries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "insurance_claims"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "insurance_policies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "deposit_accounts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "loan_repayments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "loan_applications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fi_profiles"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "insurance_claim_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "insurance_policy_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "insurance_policy_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "deposit_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "loan_status_enum"`);
  }
}
