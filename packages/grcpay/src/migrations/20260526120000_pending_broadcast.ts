import { Kysely } from 'kysely';

// Add a pre-broadcast intent column so a SIGKILL between
// `sendToAddress` returning and the durable result UPDATE can't leave
// the wallet at a state where the next tick would re-broadcast.
//
// Semantics: nullable TEXT, set BEFORE the broadcast, cleared in the
// same statement that persists the broadcast result (or on a broadcast
// exception). Format `<type>:<wallet_id>:<extra>:<unix_ms>` with the
// unix-ms ALWAYS last so recoverInterruptedSettlements can parse the
// age via `marker.slice(marker.lastIndexOf(':') + 1)`:
//   forward:<id>:<ms>                  — merchant payout in flight
//   overpayment_refund:<id>:<ms>       — buyer overpayment refund in flight
//   expired_refund_batch:<id>:<ms>     — multi-sender expired refund in flight
//                                         (single marker spans the whole batch
//                                         so a finishWithRefundTx failure
//                                         can't open a duplicate-refund window)
//   late_refund:<id>:<sender>:<ms>     — late-payment refund in flight
//
// Sites that scan for in-progress wallets (loadFunded, expireWallets,
// cancel) require pending_broadcast IS NULL so a mid-broadcast row
// stays off the candidate set. recoverInterruptedSettlements walks
// pending_broadcast IS NOT NULL rows on boot and reconciles against
// the daemon's send history.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('wallets')
    .addColumn('pending_broadcast', 'text')
    .execute();
  // Recovery sweep + filters scan on pending_broadcast IS NOT NULL —
  // index it so the predicate is cheap even with backlog.
  await db.schema
    .createIndex('wallets_pending_broadcast_idx')
    .on('wallets')
    .column('pending_broadcast')
    .where('pending_broadcast', 'is not', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('wallets_pending_broadcast_idx').execute();
  await db.schema.alterTable('wallets').dropColumn('pending_broadcast').execute();
}
