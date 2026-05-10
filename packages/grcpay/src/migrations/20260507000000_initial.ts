import { Kysely } from 'kysely';

// Compact initial schema — collapses the eight Prisma migrations from
// the previous incarnation into the current end-state. Pre-launch, so
// no on-disk data needs to be preserved; integrators get a single
// readable migration to inspect.
//
// Conventions:
// - INTEGER PRIMARY KEY AUTOINCREMENT for synthetic ids (the SQLite
//   ROWID alias). With better-sqlite3's safeIntegers on, INTEGER
//   columns read back as bigint.
// - Halford amounts are INTEGER (64-bit in SQLite). bigint at runtime.
// - Datetimes are TEXT ISO-8601. The app always supplies them via
//   lib/db.ts#now() so the format stays uniform — no DEFAULT
//   CURRENT_TIMESTAMP because SQLite's CURRENT_TIMESTAMP uses a space
//   separator, which sorts before the 'T' separator from
//   Date.toISOString() and would break lexicographic comparisons.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('wallets')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('address', 'text', (col) => col.notNull().unique())
    .addColumn('recipient', 'text')
    .addColumn('amount_required', 'integer', (col) => col.notNull())
    .addColumn('amount_recieved', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('amount_pending', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('tx_out', 'text')
    .addColumn('refund_tx', 'text')
    .addColumn('refund_amount', 'integer')
    .addColumn('mode', 'text', (col) => col.notNull().defaultTo('checkout'))
    .addColumn('lifespan_seconds', 'integer')
    .addColumn('token_hash', 'text', (col) => col.notNull())
    .addColumn('refund_attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .execute();

  // Mirrors the indexes the previous Prisma schema declared. The unique
  // on `address` already covers single-column address lookups.
  await db.schema
    .createIndex('wallets_amount_status_idx')
    .on('wallets')
    .columns(['amount_recieved', 'status'])
    .execute();
  await db.schema
    .createIndex('wallets_created_status_idx')
    .on('wallets')
    .columns(['created_at', 'status'])
    .execute();
  await db.schema
    .createIndex('wallets_status_idx')
    .on('wallets')
    .column('status')
    .execute();
  await db.schema
    .createIndex('wallets_updated_at_idx')
    .on('wallets')
    .column('updated_at')
    .execute();

  await db.schema
    .createTable('db_logs')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('wallet_id', 'integer', (col) => col.notNull())
    .addColumn('action', 'text')
    .addColumn('old_status', 'text')
    .addColumn('new_status', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex('db_logs_wallet_id_idx')
    .on('db_logs')
    .column('wallet_id')
    .execute();

  await db.schema
    .createTable('incoming_txs')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('wallet_id', 'integer', (col) => col.notNull())
    .addColumn('txid', 'text', (col) => col.notNull())
    .addColumn('amount_halford', 'integer', (col) => col.notNull())
    .addColumn('time', 'integer', (col) => col.notNull())
    .addColumn('observed_at', 'text', (col) => col.notNull())
    .addUniqueConstraint('incoming_txs_wallet_tx_unique', ['wallet_id', 'txid'])
    .execute();
  await db.schema
    .createIndex('incoming_txs_wallet_idx')
    .on('incoming_txs')
    .column('wallet_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('incoming_txs').execute();
  await db.schema.dropTable('db_logs').execute();
  await db.schema.dropTable('wallets').execute();
}
