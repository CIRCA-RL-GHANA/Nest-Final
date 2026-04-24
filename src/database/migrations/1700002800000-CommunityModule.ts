import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CommunityModule1700002800000
 *
 * Creates the three Community tables supporting all 7 UGO archetypes:
 *   - communities           : The community space (Library | Playlist | Theater | Fair | Hub | Hangout | Journal)
 *   - community_memberships : User membership + role + moderation state
 *   - community_posts       : Posts / feed items within a community
 *
 * Governance notes:
 *  - community_memberships.role controls permissions (OWNER → ADMIN → MODERATOR → MEMBER)
 *  - Banning sets status = 'banned' and records the reason.
 *  - community_posts.is_removed is the soft-moderation flag (avoids hard deletes for audit trail).
 *  - metadata (JSONB) stores type-specific data:
 *      HANGOUT  → { eventAt: ISO datetime, location: { lat, lng, address } }
 *      THEATER  → { linkedAssetIds: UUID[] }
 *      FAIR     → { expiresAt: ISO datetime, marketRef: UUID }
 *      PLAYLIST → { trackIds: UUID[], isLiveSession: bool }
 */
export class CommunityModule1700002800000 implements MigrationInterface {
  name = 'CommunityModule1700002800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "community_type_enum" AS ENUM (
        'library', 'playlist', 'theater', 'fair', 'hub', 'hangout', 'journal'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "community_status_enum" AS ENUM (
        'active', 'archived', 'suspended'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "community_visibility_enum" AS ENUM (
        'public', 'invite_only', 'private'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "member_role_enum" AS ENUM (
        'owner', 'admin', 'moderator', 'member'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "member_status_enum" AS ENUM (
        'active', 'banned', 'pending'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE IF NOT EXISTS "post_type_enum" AS ENUM (
        'text', 'link', 'poll', 'event', 'listing'
      )
    `);

    // ── communities ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "communities" (
        "id"           UUID                          NOT NULL DEFAULT gen_random_uuid(),
        "name"         VARCHAR(200)                  NOT NULL,
        "description"  TEXT,
        "type"         "community_type_enum"          NOT NULL,
        "status"       "community_status_enum"        NOT NULL DEFAULT 'active',
        "visibility"   "community_visibility_enum"    NOT NULL DEFAULT 'public',
        "owner_id"     UUID                          NOT NULL,
        "cover_url"    VARCHAR(500),
        "member_count" INTEGER                       NOT NULL DEFAULT 0,
        "post_count"   INTEGER                       NOT NULL DEFAULT 0,
        "metadata"     JSONB,
        "tags"         VARCHAR(500),
        "created_at"   TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
        "updated_at"   TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
        "deleted_at"   TIMESTAMPTZ,
        CONSTRAINT "pk_communities" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_communities_type"       ON "communities" ("type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_communities_owner"      ON "communities" ("owner_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_communities_status"     ON "communities" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_communities_visibility" ON "communities" ("visibility")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_communities_name"       ON "communities" ("name")`);

    // ── community_memberships ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "community_memberships" (
        "id"            UUID                  NOT NULL DEFAULT gen_random_uuid(),
        "community_id"  UUID                  NOT NULL,
        "user_id"       UUID                  NOT NULL,
        "role"          "member_role_enum"    NOT NULL DEFAULT 'member',
        "status"        "member_status_enum"  NOT NULL DEFAULT 'active',
        "ban_reason"    TEXT,
        "invite_token"  VARCHAR(100),
        "created_at"    TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
        "updated_at"    TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
        "deleted_at"    TIMESTAMPTZ,
        CONSTRAINT "pk_community_memberships" PRIMARY KEY ("id"),
        CONSTRAINT "uq_community_memberships_user" UNIQUE ("community_id", "user_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_community_memberships_community" ON "community_memberships" ("community_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_community_memberships_user"      ON "community_memberships" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_community_memberships_role"      ON "community_memberships" ("role")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_community_memberships_status"    ON "community_memberships" ("status")`);

    // ── community_posts ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "community_posts" (
        "id"                UUID              NOT NULL DEFAULT gen_random_uuid(),
        "community_id"      UUID              NOT NULL,
        "author_id"         UUID              NOT NULL,
        "type"              "post_type_enum"  NOT NULL DEFAULT 'text',
        "title"             VARCHAR(500),
        "body"              TEXT,
        "linked_content_id" UUID,
        "metadata"          JSONB,
        "like_count"        INTEGER           NOT NULL DEFAULT 0,
        "comment_count"     INTEGER           NOT NULL DEFAULT 0,
        "is_pinned"         BOOLEAN           NOT NULL DEFAULT FALSE,
        "is_removed"        BOOLEAN           NOT NULL DEFAULT FALSE,
        "created_at"        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        "updated_at"        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        "deleted_at"        TIMESTAMPTZ,
        CONSTRAINT "pk_community_posts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_community_posts_community"        ON "community_posts" ("community_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_community_posts_author"           ON "community_posts" ("author_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_community_posts_type"             ON "community_posts" ("type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_community_posts_community_time"   ON "community_posts" ("community_id", "created_at" DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "community_posts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "community_memberships"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "communities"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "post_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "member_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "member_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "community_visibility_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "community_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "community_type_enum"`);
  }
}
