import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddAiPluginsTable
 *
 * Creates the ai_plugins table for the plugin registry system.
 * Plugins are sandboxed code snippets registered at runtime and
 * executed with timeout protection.
 */
export class AddAiPluginsTable1700002500000 implements MigrationInterface {
  name = 'AddAiPluginsTable1700002500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enums
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ai_plugins_plugintype_enum" AS ENUM (
          'transform', 'enrichment', 'notification', 'validator', 'connector'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ai_plugins_status_enum" AS ENUM (
          'active', 'inactive', 'error'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_plugins" (
        "id"                UUID          NOT NULL DEFAULT gen_random_uuid(),
        "name"              VARCHAR(100)  NOT NULL,
        "description"       VARCHAR(500),
        "plugin_type"       "ai_plugins_plugintype_enum" NOT NULL,
        "version"           VARCHAR(20)   NOT NULL DEFAULT '1.0.0',
        "status"            "ai_plugins_status_enum" NOT NULL DEFAULT 'inactive',
        "handler_code"      TEXT          NOT NULL,
        "config"            JSONB,
        "permissions"       TEXT,
        "timeout_ms"        INTEGER       NOT NULL DEFAULT 5000,
        "execution_count"   INTEGER       NOT NULL DEFAULT 0,
        "error_count"       INTEGER       NOT NULL DEFAULT 0,
        "last_error"        TEXT,
        "last_executed_at"  TIMESTAMP,
        "created_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at"        TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_ai_plugins" PRIMARY KEY ("id"),
        CONSTRAINT "uq_ai_plugins_name" UNIQUE ("name")
      );
    `);

    // Indexes
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_ai_plugins_type"   ON "ai_plugins" ("plugin_type");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_ai_plugins_status" ON "ai_plugins" ("status");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_plugins";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ai_plugins_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ai_plugins_plugintype_enum";`);
  }
}
