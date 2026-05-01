import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ExtendQPointsTransactionTypes1715000000001
 *
 * The original qpoint_transactions.type column was created with an inline
 * anonymous CHECK constraint that only permits the original 8 values:
 *   'Deposit','Withdrawal','Transfer','Purchase','Refund','Reward','Fee','Penalty'
 *
 * The Financial Institution extension adds 9 new transaction sub-types to the
 * TransactionType enum at the application level. This migration:
 *   1. Drops the anonymous CHECK constraint (named by Postgres as
 *      "qpoint_transactions_type_check") so writes of FI transaction types
 *      are no longer blocked at the DB layer.
 *   2. Widens the column to VARCHAR(50) to accommodate the longer names.
 *
 * TypeORM validates enum values at the application level, so removing the DB
 * CHECK is safe — invalid values cannot reach this column from application code.
 */
export class ExtendQPointsTransactionTypes1715000000001 implements MigrationInterface {
  name = 'ExtendQPointsTransactionTypes1715000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the auto-generated anonymous check constraint.
    // Postgres names inline CHECK constraints as <table>_<column>_check.
    await queryRunner.query(`
      ALTER TABLE "qpoint_transactions"
        DROP CONSTRAINT IF EXISTS "qpoint_transactions_type_check"
    `);

    // Widen the column to hold longer FI type strings (e.g. 'InsuranceClaimPayout')
    await queryRunner.query(`
      ALTER TABLE "qpoint_transactions"
        ALTER COLUMN "type" TYPE VARCHAR(50)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add the original constraint (removes FI transactions if any were written)
    await queryRunner.query(`
      ALTER TABLE "qpoint_transactions"
        ALTER COLUMN "type" TYPE VARCHAR(20)
    `);

    await queryRunner.query(`
      ALTER TABLE "qpoint_transactions"
        ADD CONSTRAINT "qpoint_transactions_type_check"
          CHECK ("type" IN (
            'Deposit','Withdrawal','Transfer','Purchase',
            'Refund','Reward','Fee','Penalty'
          ))
    `);
  }
}
