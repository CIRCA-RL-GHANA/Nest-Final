import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EPlayModule1700002700000
 *
 * Creates the three e-Play tables:
 *   - creator_profiles  : Creator's "digital branch"
 *   - digital_assets    : DRM-protected content catalogue
 *   - eplay_licenses    : User cloud-locker entries (purchase rights)
 *
 * Design notes:
 *  - Content is NEVER downloaded raw; the encrypted_storage_ref is a server-
 *    side CDN key. Stream tokens are issued per-request with short TTL.
 *  - Royalties: 15% platform cut; 85% creator. Recorded in revenue_records.
 *  - Access models: perpetual | rental (time-bound) | subscription.
 */
export class EPlayModule1700002700000 implements MigrationInterface {
  name = 'EPlayModule1700002700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // â”€â”€ Enums â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "digital_asset_type_enum" AS ENUM (
          'music', 'movie', 'podcast', 'ebook', 'show'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "digital_asset_status_enum" AS ENUM (
          'draft', 'published', 'unlisted', 'removed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "access_model_enum" AS ENUM (
          'perpetual', 'rental', 'subscription'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "license_status_enum" AS ENUM (
          'active', 'expired', 'revoked'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "creator_tier_enum" AS ENUM (
          'indie', 'verified', 'label'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // â”€â”€ creator_profiles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "creator_profiles" (
        "id"                      UUID          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                 UUID          NOT NULL UNIQUE,
        "display_name"            VARCHAR(200)  NOT NULL,
        "bio"                     TEXT,
        "avatar_url"              VARCHAR(500),
        "banner_url"              VARCHAR(500),
        "tier"                    "creator_tier_enum" NOT NULL DEFAULT 'indie',
        "payout_account_id"       UUID,
        "creator_royalty_pct"     DECIMAL(5,2)  NOT NULL DEFAULT 85,
        "allowed_regions"         JSONB,
        "is_active"               BOOLEAN       NOT NULL DEFAULT TRUE,
        "total_earnings_q_points" DECIMAL(14,4) NOT NULL DEFAULT 0,
        "asset_count"             INTEGER       NOT NULL DEFAULT 0,
        "follower_count"          INTEGER       NOT NULL DEFAULT 0,
        "created_at"              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "updated_at"              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "deleted_at"              TIMESTAMPTZ,
        CONSTRAINT "pk_creator_profiles" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_creator_profiles_user_id" ON "creator_profiles" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_creator_profiles_tier"    ON "creator_profiles" ("tier")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_creator_profiles_active"  ON "creator_profiles" ("is_active")`);

    // â”€â”€ digital_assets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "digital_assets" (
        "id"                   UUID                           NOT NULL DEFAULT gen_random_uuid(),
        "title"                VARCHAR(300)                   NOT NULL,
        "description"          TEXT,
        "type"                 "digital_asset_type_enum"      NOT NULL,
        "status"               "digital_asset_status_enum"    NOT NULL DEFAULT 'draft',
        "access_model"         "access_model_enum"            NOT NULL DEFAULT 'perpetual',
        "creator_profile_id"   UUID                           NOT NULL,
        "price_q_points"       DECIMAL(10,2)                  NOT NULL,
        "rental_duration_days" INTEGER,
        "cover_url"            VARCHAR(500),
        "encrypted_storage_ref" VARCHAR(500)                  NOT NULL,
        "duration_seconds"     INTEGER,
        "file_size_bytes"      BIGINT,
        "tags"                 VARCHAR(500),
        "allowed_regions"      JSONB,
        "platform_royalty_pct" DECIMAL(5,2)                   NOT NULL DEFAULT 15,
        "purchase_count"       INTEGER                        NOT NULL DEFAULT 0,
        "play_count"           INTEGER                        NOT NULL DEFAULT 0,
        "created_at"           TIMESTAMPTZ                    NOT NULL DEFAULT NOW(),
        "updated_at"           TIMESTAMPTZ                    NOT NULL DEFAULT NOW(),
        "deleted_at"           TIMESTAMPTZ,
        CONSTRAINT "pk_digital_assets" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_digital_assets_creator"  ON "digital_assets" ("creator_profile_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_digital_assets_type"     ON "digital_assets" ("type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_digital_assets_status"   ON "digital_assets" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_digital_assets_title"    ON "digital_assets" ("title")`);

    // â”€â”€ eplay_licenses â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "eplay_licenses" (
        "id"                    UUID                  NOT NULL DEFAULT gen_random_uuid(),
        "user_id"               UUID                  NOT NULL,
        "digital_asset_id"      UUID                  NOT NULL,
        "status"                "license_status_enum" NOT NULL DEFAULT 'active',
        "expires_at"            TIMESTAMPTZ,
        "amount_paid_q_points"  DECIMAL(10,2)         NOT NULL,
        "transaction_id"        UUID,
        "last_accessed_at"      TIMESTAMPTZ,
        "is_pinned"             BOOLEAN               NOT NULL DEFAULT FALSE,
        "created_at"            TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
        "updated_at"            TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
        "deleted_at"            TIMESTAMPTZ,
        CONSTRAINT "pk_eplay_licenses" PRIMARY KEY ("id"),
        CONSTRAINT "uq_eplay_licenses_user_asset" UNIQUE ("user_id", "digital_asset_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_eplay_licenses_user_id"   ON "eplay_licenses" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_eplay_licenses_asset_id"  ON "eplay_licenses" ("digital_asset_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_eplay_licenses_status"    ON "eplay_licenses" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_eplay_licenses_expires"   ON "eplay_licenses" ("expires_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "eplay_licenses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "digital_assets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "creator_profiles"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "creator_tier_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "license_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "access_model_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "digital_asset_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "digital_asset_type_enum"`);
  }
}
