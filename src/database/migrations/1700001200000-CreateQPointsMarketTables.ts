import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

/**
 * Migration: Q Points Market Tables
 *
 * Creates five new tables for the Q Points liquid market system:
 *   - q_point_orders       : limit order book entries
 *   - q_point_trades       : executed trade records
 *   - q_point_market_balances : per-user market QP balance (separate from internal accounts)
 *   - q_point_settlements  : cash movement records (via payment facilitator)
 *   - q_point_market_notifications : real-time user notifications
 *
 * No existing tables are modified.
 */
export class CreateQPointsMarketTables1700001200000 implements MigrationInterface {
  name = 'CreateQPointsMarketTables1700001200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------ orders
    await queryRunner.createTable(
      new Table({
        name: 'q_point_orders',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'user_id', type: 'uuid', isNullable: false },
          {
            name: 'type',
            type: 'text',
            isNullable: false,
            comment: 'buy | sell',
          },
          { name: 'price', type: 'decimal', precision: 10, scale: 4, isNullable: false },
          { name: 'quantity', type: 'decimal', precision: 18, scale: 4, isNullable: false },
          {
            name: 'filled_quantity',
            type: 'decimal',
            precision: 18,
            scale: 4,
            default: 0,
          },
          {
            name: 'status',
            type: 'text',
            default: "'open'",
            comment: 'open | filled | cancelled | expired',
          },
          { name: 'created_at', type: 'timestamp with time zone', default: 'now()' },
          { name: 'updated_at', type: 'timestamp with time zone', default: 'now()' },
        ],
        checks: [
          { expression: `type IN ('buy','sell')` },
          { expression: `status IN ('open','filled','cancelled','expired')` },
          { expression: 'price > 0' },
          { expression: 'quantity > 0' },
          { expression: 'filled_quantity >= 0' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'q_point_orders',
      new TableIndex({ name: 'idx_qpo_user_status', columnNames: ['user_id', 'status'] }),
    );
    await queryRunner.createIndex(
      'q_point_orders',
      new TableIndex({
        name: 'idx_qpo_type_price_open',
        columnNames: ['type', 'price'],
        where: `status = 'open'`,
      }),
    );

    await queryRunner.createForeignKey(
      'q_point_orders',
      new TableForeignKey({
        name: 'fk_qpo_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // ------------------------------------------------------------------ trades
    await queryRunner.createTable(
      new Table({
        name: 'q_point_trades',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'buy_order_id', type: 'uuid', isNullable: false },
          { name: 'sell_order_id', type: 'uuid', isNullable: false },
          { name: 'price', type: 'decimal', precision: 10, scale: 4, isNullable: false },
          { name: 'quantity', type: 'decimal', precision: 18, scale: 4, isNullable: false },
          { name: 'buyer_id', type: 'uuid', isNullable: false },
          { name: 'seller_id', type: 'uuid', isNullable: false },
          { name: 'created_at', type: 'timestamp with time zone', default: 'now()' },
        ],
        checks: [{ expression: 'price > 0' }, { expression: 'quantity > 0' }],
      }),
      true,
    );

    await queryRunner.createIndex(
      'q_point_trades',
      new TableIndex({ name: 'idx_qpt_buyer', columnNames: ['buyer_id'] }),
    );
    await queryRunner.createIndex(
      'q_point_trades',
      new TableIndex({ name: 'idx_qpt_seller', columnNames: ['seller_id'] }),
    );
    await queryRunner.createIndex(
      'q_point_trades',
      new TableIndex({ name: 'idx_qpt_created', columnNames: ['created_at'] }),
    );

    await queryRunner.createForeignKeys('q_point_trades', [
      new TableForeignKey({
        name: 'fk_qpt_buy_order',
        columnNames: ['buy_order_id'],
        referencedTableName: 'q_point_orders',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
      new TableForeignKey({
        name: 'fk_qpt_sell_order',
        columnNames: ['sell_order_id'],
        referencedTableName: 'q_point_orders',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
      new TableForeignKey({
        name: 'fk_qpt_buyer',
        columnNames: ['buyer_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
      new TableForeignKey({
        name: 'fk_qpt_seller',
        columnNames: ['seller_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    ]);

    // -------------------------------------------------------- market balances
    await queryRunner.createTable(
      new Table({
        name: 'q_point_market_balances',
        columns: [
          { name: 'user_id', type: 'uuid', isPrimary: true },
          {
            name: 'balance',
            type: 'decimal',
            precision: 28,
            scale: 4,
            default: 0,
          },
          { name: 'updated_at', type: 'timestamp with time zone', default: 'now()' },
        ],
        checks: [{ expression: 'balance >= 0' }],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'q_point_market_balances',
      new TableForeignKey({
        name: 'fk_qpmb_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // ---------------------------------------------------------- settlements
    await queryRunner.createTable(
      new Table({
        name: 'q_point_settlements',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'trade_id', type: 'uuid', isNullable: true },
          { name: 'user_id', type: 'uuid', isNullable: false },
          { name: 'amount', type: 'decimal', precision: 10, scale: 2, isNullable: false },
          {
            name: 'type',
            type: 'text',
            isNullable: false,
            comment: 'debit | credit',
          },
          {
            name: 'status',
            type: 'text',
            default: "'pending'",
            comment: 'pending | completed | failed',
          },
          { name: 'facilitator_reference', type: 'varchar', length: '255', isNullable: true },
          { name: 'created_at', type: 'timestamp with time zone', default: 'now()' },
          { name: 'completed_at', type: 'timestamp with time zone', isNullable: true },
        ],
        checks: [
          { expression: `type IN ('debit','credit')` },
          { expression: `status IN ('pending','completed','failed')` },
          { expression: 'amount > 0' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'q_point_settlements',
      new TableIndex({ name: 'idx_qps_user', columnNames: ['user_id'] }),
    );
    await queryRunner.createIndex(
      'q_point_settlements',
      new TableIndex({ name: 'idx_qps_trade', columnNames: ['trade_id'] }),
    );
    await queryRunner.createIndex(
      'q_point_settlements',
      new TableIndex({ name: 'idx_qps_status', columnNames: ['status'] }),
    );

    await queryRunner.createForeignKeys('q_point_settlements', [
      new TableForeignKey({
        name: 'fk_qps_trade',
        columnNames: ['trade_id'],
        referencedTableName: 'q_point_trades',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
      new TableForeignKey({
        name: 'fk_qps_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    ]);

    // ----------------------------------------------------- market notifications
    await queryRunner.createTable(
      new Table({
        name: 'q_point_market_notifications',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'user_id', type: 'uuid', isNullable: false },
          { name: 'type', type: 'varchar', length: '50', isNullable: false },
          { name: 'message', type: 'text', isNullable: false },
          { name: 'data', type: 'jsonb', isNullable: true },
          { name: 'read', type: 'boolean', default: false },
          { name: 'created_at', type: 'timestamp with time zone', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'q_point_market_notifications',
      new TableIndex({ name: 'idx_qpmn_user_read', columnNames: ['user_id', 'read'] }),
    );
    await queryRunner.createIndex(
      'q_point_market_notifications',
      new TableIndex({ name: 'idx_qpmn_created', columnNames: ['created_at'] }),
    );

    await queryRunner.createForeignKey(
      'q_point_market_notifications',
      new TableForeignKey({
        name: 'fk_qpmn_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // ----------------------------------------------- AI participant seed row
    // NOTE: The AI participant UUID must also exist in the users table.
    // This migration inserts only the balance row; the users seed is separate.
    // Genesis allocation: entire fixed supply (500 trillion QP) goes to the AI market maker.
    // No new QP can ever be minted beyond this cap — all human balances are funded
    // exclusively by the AI distributing from its own position.
    await queryRunner.query(`
      INSERT INTO q_point_market_balances (user_id, balance)
      VALUES ('00000000-0000-0000-0000-000000000001', 500000000000000)
      ON CONFLICT (user_id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('q_point_market_notifications', true);
    await queryRunner.dropTable('q_point_settlements', true);
    await queryRunner.dropTable('q_point_market_balances', true);
    await queryRunner.dropTable('q_point_trades', true);
    await queryRunner.dropTable('q_point_orders', true);
  }
}
