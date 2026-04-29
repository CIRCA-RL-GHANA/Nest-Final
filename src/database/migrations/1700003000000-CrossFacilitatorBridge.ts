import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Cross-Facilitator Bridge System
 *
 * Adds the schema required for the AI Participant's matched-principal
 * cross-facilitator bridge transaction engine.
 *
 * Changes:
 *   1. ALTER q_point_orders  — add facilitator_id column
 *   2. ALTER q_point_trades  — add buyer_facilitator_id, seller_facilitator_id,
 *                              is_cross_facilitator, cross_facilitator_pair_id
 *   3. CREATE ai_facilitator_balances — AI cash balance per facilitator
 *   4. CREATE netting_tasks           — rebalancing task queue for finance team
 *
 * Legal basis (TOS §4.3 + §5.2):
 *   - The platform NEVER initiates fiat transfers.
 *   - The AI acts as a matched principal (ordinary user, not money transmitter).
 *   - The netting tasks are company-internal treasury operations (not money transmission).
 */
export class CrossFacilitatorBridge1700003000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Add facilitator_id to q_point_orders ──────────────────────────────
    await queryRunner.query(`
      ALTER TABLE q_point_orders
        ADD COLUMN IF NOT EXISTS facilitator_id VARCHAR(32) DEFAULT NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_qpo_facilitator
        ON q_point_orders (facilitator_id)
        WHERE facilitator_id IS NOT NULL;
    `);

    // ── 2. Add cross-facilitator columns to q_point_trades ───────────────────
    await queryRunner.query(`
      ALTER TABLE q_point_trades
        ADD COLUMN IF NOT EXISTS buyer_facilitator_id  VARCHAR(32)  DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS seller_facilitator_id VARCHAR(32)  DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS is_cross_facilitator  BOOLEAN      NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS cross_facilitator_pair_id UUID     DEFAULT NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_qpt_cf_pair
        ON q_point_trades (cross_facilitator_pair_id)
        WHERE cross_facilitator_pair_id IS NOT NULL;
    `);

    // ── 3. CREATE ai_facilitator_balances ────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_facilitator_balances (
        id                    UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        facilitator_id        VARCHAR(32)  NOT NULL,
        cash_balance_usd      DECIMAL(18,4) NOT NULL DEFAULT 0,
        min_reserve_usd       DECIMAL(18,2) NOT NULL DEFAULT 10000,
        is_bridge_active      BOOLEAN      NOT NULL DEFAULT FALSE,
        daily_outflow_usd     DECIMAL(18,2) NOT NULL DEFAULT 0,
        daily_outflow_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
        created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_ai_facilitator_balances_provider UNIQUE (facilitator_id)
      );
    `);
    await queryRunner.query(`
      COMMENT ON TABLE ai_facilitator_balances IS
        'Tracks the AI Participant cash balance at each payment facilitator. '
        'Used by the cross-facilitator bridge engine (TOS §5.2 matched principal).';
    `);

    // ── 4. CREATE netting_tasks ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS netting_tasks (
        id                          UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        source_facilitator_id       VARCHAR(32)  NOT NULL,
        target_facilitator_id       VARCHAR(32)  NOT NULL,
        amount_usd                  DECIMAL(18,2) NOT NULL,
        status                      TEXT         NOT NULL DEFAULT 'pending',
        source_balance_at_creation  DECIMAL(18,2) DEFAULT NULL,
        target_balance_at_creation  DECIMAL(18,2) DEFAULT NULL,
        notes                       TEXT         DEFAULT NULL,
        completed_by_admin_id       UUID         DEFAULT NULL,
        transfer_reference          VARCHAR(255) DEFAULT NULL,
        created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        completed_at                TIMESTAMP WITH TIME ZONE DEFAULT NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_netting_tasks_status
        ON netting_tasks (status);
    `);
    await queryRunner.query(`
      COMMENT ON TABLE netting_tasks IS
        'Rebalancing tasks created by the NettingEngine when the AI cash at a facilitator '
        'deviates beyond the reserve threshold. Platform finance team executes wires to complete. '
        'These are company treasury operations (not money transmission per TOS §4.3).';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop new tables
    await queryRunner.query(`DROP TABLE IF EXISTS netting_tasks;`);
    await queryRunner.query(`DROP TABLE IF EXISTS ai_facilitator_balances;`);

    // Remove cross-facilitator index + columns from q_point_trades
    await queryRunner.query(`DROP INDEX IF EXISTS idx_qpt_cf_pair;`);
    await queryRunner.query(`
      ALTER TABLE q_point_trades
        DROP COLUMN IF EXISTS buyer_facilitator_id,
        DROP COLUMN IF EXISTS seller_facilitator_id,
        DROP COLUMN IF EXISTS is_cross_facilitator,
        DROP COLUMN IF EXISTS cross_facilitator_pair_id;
    `);

    // Remove facilitator_id from q_point_orders
    await queryRunner.query(`DROP INDEX IF EXISTS idx_qpo_facilitator;`);
    await queryRunner.query(`
      ALTER TABLE q_point_orders
        DROP COLUMN IF EXISTS facilitator_id;
    `);
  }
}
