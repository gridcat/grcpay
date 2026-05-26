import { db, now } from '../../src/lib/db';
import { migrateToLatest } from '../../src/lib/migrate';
import { WalletStatus, WalletMode } from '../../src/models/Wallet';
import type { WalletRow } from '../../src/lib/database';

interface InsertWalletOverrides {
  address?: string;
  recipient?: string | null;
  amount_required?: bigint;
  amount_recieved?: bigint;
  amount_pending?: bigint;
  status?: WalletStatus;
  tx_out?: string | null;
  refund_tx?: string | null;
  refund_amount?: bigint | null;
  mode?: WalletMode;
  lifespan_seconds?: number | null;
  token_hash?: string;
  refund_attempts?: number;
  pending_broadcast?: string | null;
  created_at?: string;
  updated_at?: string;
}

let migrated = false;

/**
 * Idempotent migration of the in-memory test DB. Each Jest worker
 * runs in a single process (--runInBand) so the better-sqlite3
 * `:memory:` connection is shared across test files; migrating once
 * is enough.
 */
export async function setupTestDb(): Promise<void> {
  if (migrated) return;
  await migrateToLatest();
  migrated = true;
}

/**
 * Wipe every table between tests. Use in a beforeEach so each test
 * sees a fresh DB without paying the cost of re-migrating.
 */
export async function truncateAll(): Promise<void> {
  // Order matters only if foreign keys are enabled; we don't have any
  // declared, but keep child-first ordering for clarity.
  await db.deleteFrom('webhook_deliveries').execute();
  await db.deleteFrom('wallet_webhooks').execute();
  await db.deleteFrom('incoming_txs').execute();
  await db.deleteFrom('db_logs').execute();
  await db.deleteFrom('wallets').execute();
}

/**
 * Inserts a fixture wallet row and returns it. Defaults match a
 * freshly-minted, single-customer checkout wallet.
 */
export async function insertWallet(overrides: InsertWalletOverrides = {}): Promise<WalletRow> {
  const ts = overrides.created_at ?? now();
  return db
    .insertInto('wallets')
    .values({
      address: overrides.address ?? 'S1234567890abcdef1234567890abcdef12',
      recipient: overrides.recipient ?? null,
      amount_required: overrides.amount_required ?? BigInt(1_000_000_000), // 10 GRC
      amount_recieved: overrides.amount_recieved ?? BigInt(0),
      amount_pending: overrides.amount_pending ?? BigInt(0),
      status: overrides.status ?? WalletStatus.new,
      tx_out: overrides.tx_out ?? null,
      refund_tx: overrides.refund_tx ?? null,
      refund_amount: overrides.refund_amount ?? null,
      mode: overrides.mode ?? WalletMode.checkout,
      lifespan_seconds: overrides.lifespan_seconds == null
        ? null
        : BigInt(overrides.lifespan_seconds),
      token_hash: overrides.token_hash ?? 'deadbeef'.repeat(8),
      refund_attempts: BigInt(overrides.refund_attempts ?? 0),
      pending_broadcast: overrides.pending_broadcast ?? null,
      created_at: ts,
      updated_at: overrides.updated_at ?? ts,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
