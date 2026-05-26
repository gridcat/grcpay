import { Kysely } from 'kysely';

// Outbound webhooks. Two tables, same conventions as the initial
// migration (INTEGER PRIMARY KEY AUTOINCREMENT, INTEGER halford/ids
// read back as bigint, TEXT ISO-8601 datetimes always supplied by the
// app — no DEFAULT CURRENT_TIMESTAMP).
//
// wallet_webhooks   — opt-in callback config, one row per wallet that
//                      passed a webhookUrl at POST /wallets.
// webhook_deliveries — the durable queue. One row per worthy status
//                      transition; the dispatcher drains it. Durability
//                      lives here, NOT in the in-process event emitter,
//                      so a restart mid-flight can't drop a delivery.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('wallet_webhooks')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    // Logical FK to wallets.id. No FK constraint declared (the project
    // declares none anywhere); unique enforces one webhook per wallet.
    .addColumn('wallet_id', 'integer', (col) => col.notNull())
    .addColumn('url', 'text', (col) => col.notNull())
    // Raw HMAC key — deliberately NOT hashed like wallets.token_hash.
    // A signing key that's been SHA256'd is useless at delivery time;
    // we must keep the raw secret to HMAC every payload. It's revealed
    // once in the POST /wallets response and never again.
    .addColumn('secret', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    // The unique constraint already provides the wallet_id lookup
    // index — no separate createIndex needed.
    .addUniqueConstraint('wallet_webhooks_wallet_unique', ['wallet_id'])
    .execute();

  await db.schema
    .createTable('webhook_deliveries')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('wallet_id', 'integer', (col) => col.notNull())
    // Stable idempotency key sent to the receiver as X-Grcpay-Event-Id
    // so it can dedupe across our at-least-once retries.
    .addColumn('event_uuid', 'text', (col) => col.notNull())
    // Always supplied; absent transitions are normalised to '' (never
    // NULL) by the enqueue path — SQLite UNIQUE treats NULLs as
    // distinct, so a NULL here would silently defeat the dedup
    // constraint below.
    .addColumn('old_status', 'text', (col) => col.notNull())
    .addColumn('new_status', 'text', (col) => col.notNull())
    // Frozen JSON snapshot built at enqueue time so a later wallet
    // mutation can't change what we eventually deliver.
    .addColumn('payload', 'text', (col) => col.notNull())
    // pending | delivered | dead
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('next_attempt_at', 'text', (col) => col.notNull())
    .addColumn('last_response_code', 'integer')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    // At-most-once enqueue per (wallet, transition). A reconciler flap
    // (new↔confirming) or the same tx reappearing across ticks bounces
    // off this instead of spamming the receiver.
    .addUniqueConstraint(
      'webhook_deliveries_dedup_unique',
      ['wallet_id', 'new_status', 'old_status'],
    )
    .execute();
  // The dispatcher's claim query: WHERE status=? AND next_attempt_at<=?
  await db.schema
    .createIndex('webhook_deliveries_due_idx')
    .on('webhook_deliveries')
    .columns(['status', 'next_attempt_at'])
    .execute();
  await db.schema
    .createIndex('webhook_deliveries_wallet_idx')
    .on('webhook_deliveries')
    .column('wallet_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('webhook_deliveries').execute();
  await db.schema.dropTable('wallet_webhooks').execute();
}
