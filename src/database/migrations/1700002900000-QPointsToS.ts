import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: QPoints Terms of Service Acceptance Tracking
 *
 * Creates the `qpoints_tos_acceptances` table — an append-only audit ledger
 * recording every user's acceptance of a specific version of the Q Points
 * Terms of Service, including IP address, user agent, platform, and the
 * SHA-256 hash of the exact ToS text shown.
 *
 * Legal basis: Republic of Ghana law; Q Points ToS Section 3.1 (Eligibility).
 *
 * Design decisions:
 *  - UNIQUE constraint on (user_id, tos_version) ensures one record per user
 *    per version, while allowing a new row when a major version bump requires
 *    re-acceptance.
 *  - No UPDATE or DELETE permissions should be granted to the application
 *    role on this table in production (enforce in database RBAC if possible).
 *  - tos_content_hash (SHA-256) provides tamper-evident proof of the exact
 *    ToS text the user saw.
 */
export class QPointsToSMigration1700002900000 implements MigrationInterface {
  name = 'QPointsToSMigration1700002900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "qpoints_tos_acceptances" (
        "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"           UUID        NOT NULL,
        "tos_version"       VARCHAR(20) NOT NULL,
        "ip_address"        VARCHAR(45) NOT NULL,
        "user_agent"        TEXT        NOT NULL,
        "platform"          VARCHAR(20) NOT NULL DEFAULT 'web',
        "read_confirmed"    BOOLEAN     NOT NULL DEFAULT FALSE,
        "risk_confirmed"    BOOLEAN     NOT NULL DEFAULT FALSE,
        "age_confirmed"     BOOLEAN     NOT NULL DEFAULT FALSE,
        "tos_content_hash"  VARCHAR(64) NOT NULL,
        "accepted_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "pk_qpoints_tos_acceptances" PRIMARY KEY ("id"),
        CONSTRAINT "fk_qpts_tos_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    // Unique constraint: one acceptance record per user per ToS version
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_qpts_tos_user_version"
        ON "qpoints_tos_acceptances" ("user_id", "tos_version");
    `);

    // Index to quickly look up all acceptances for a user (audit/admin)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_qpts_tos_user"
        ON "qpoints_tos_acceptances" ("user_id");
    `);

    // Index to query acceptances by version (mass-re-acceptance campaigns)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_qpts_tos_version"
        ON "qpoints_tos_acceptances" ("tos_version");
    `);

    // Comment the table for database documentation
    await queryRunner.query(`
      COMMENT ON TABLE "qpoints_tos_acceptances" IS
        'Append-only legal audit log of Q Points ToS acceptances per user per version. ' ||
        'Do NOT delete or update rows. SHA-256 hash provides tamper-evident proof.';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_qpts_tos_version"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_qpts_tos_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_qpts_tos_user_version"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "qpoints_tos_acceptances"`);
  }
}
