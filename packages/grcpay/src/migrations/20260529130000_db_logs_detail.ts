import { Kysely } from 'kysely';

// Free-text failure reason on a db_logs row. The status machine records
// transitions (action + old/new status) but not WHY a wallet landed
// somewhere — e.g. a funded wallet flips to `error` because the
// merchant-forward sendToAddress was rejected ("coins already spent").
// Persisting the reason here makes it visible to read-only observers
// (grc-control reads this SQLite directly) instead of only in the
// container's stdout. Nullable: routine transitions carry no detail.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('db_logs').addColumn('detail', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('db_logs').dropColumn('detail').execute();
}
