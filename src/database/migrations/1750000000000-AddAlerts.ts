import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAlerts1750000000000 implements MigrationInterface {
  name = 'AddAlerts1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."alerts_priority_enum" AS ENUM('critical', 'high', 'medium', 'low')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."alerts_status_enum" AS ENUM('new', 'assigned', 'in_progress', 'escalated', 'resolved', 'verified', 'closed', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."alerts_category_enum" AS ENUM('payment', 'shipment', 'system', 'driver_ride', 'return_refund', 'account', 'security', 'other')`,
    );
    await queryRunner.query(`
      CREATE TABLE "alerts" (
        "id"               uuid                          NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"       TIMESTAMP WITH TIME ZONE      NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMP WITH TIME ZONE      NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMP WITH TIME ZONE,
        "title"            character varying(500)        NOT NULL,
        "description"      text                          NOT NULL,
        "priority"         "public"."alerts_priority_enum" NOT NULL DEFAULT 'medium',
        "status"           "public"."alerts_status_enum"   NOT NULL DEFAULT 'new',
        "category"         "public"."alerts_category_enum" NOT NULL DEFAULT 'other',
        "subCategory"      character varying(100),
        "createdBy"        character varying(200)        NOT NULL DEFAULT 'System',
        "entityId"         uuid,
        "assigneeId"       uuid,
        "assigneeName"     character varying(200),
        "assigneeRole"     character varying(100),
        "tags"             text,
        "slaInfo"          jsonb,
        "technicalDetails" jsonb,
        "resolution"       jsonb,
        "timeline"         jsonb                         NOT NULL DEFAULT '[]',
        "isBookmarked"     boolean                       NOT NULL DEFAULT false,
        CONSTRAINT "PK_alerts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_alerts_entity_status"   ON "alerts" ("entityId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_alerts_entity_priority" ON "alerts" ("entityId", "priority")`);
    await queryRunner.query(`CREATE INDEX "IDX_alerts_assignee"        ON "alerts" ("assigneeId")`);
    await queryRunner.query(`CREATE INDEX "IDX_alerts_entity"          ON "alerts" ("entityId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_alerts_entity"`);
    await queryRunner.query(`DROP INDEX "IDX_alerts_assignee"`);
    await queryRunner.query(`DROP INDEX "IDX_alerts_entity_priority"`);
    await queryRunner.query(`DROP INDEX "IDX_alerts_entity_status"`);
    await queryRunner.query(`DROP TABLE "alerts"`);
    await queryRunner.query(`DROP TYPE "public"."alerts_category_enum"`);
    await queryRunner.query(`DROP TYPE "public"."alerts_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."alerts_priority_enum"`);
  }
}
