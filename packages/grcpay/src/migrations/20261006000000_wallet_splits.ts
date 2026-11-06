import { Kysely } from 'kysely';

// A wallet may split its payout: up to MAX_SPLITS extra outputs, each a
// fixed share of amount_required (e.g. a marketplace donation or a
// platform fee), paid in the same sendMany as the primary recipient,
// who still bears the network fee. Stored as JSON (lib/splits.ts);
// NULL means a single-recipient payout.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('wallets').addColumn('splits', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('wallets').dropColumn('splits').execute();
}
