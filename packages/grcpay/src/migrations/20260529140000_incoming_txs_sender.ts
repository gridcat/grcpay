import { Kysely } from 'kysely';

// Persist the SENDER of each incoming receive. listTransactions (what
// the indexer scans) only reports the receiving address; the payer is
// in the tx's inputs. grcpay already decodes that on-demand for refund
// targeting (senderLookup) but never stored it — so observers couldn't
// see "who paid". The indexer now resolves it per new receive and
// writes it here. Nullable: resolution can fail (RPC error) or the tx
// can be a self-spend, and existing rows pre-date the column.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('incoming_txs').addColumn('sender_address', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('incoming_txs').dropColumn('sender_address').execute();
}
