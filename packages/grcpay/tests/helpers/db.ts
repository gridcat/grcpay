import type { Migration, MigrationProvider } from 'kysely';
import * as initial from '../../src/migrations/20260507000000_initial';
import * as webhooks from '../../src/migrations/20260519120000_webhooks';
import * as pendingBroadcast from '../../src/migrations/20260526120000_pending_broadcast';
import * as dbLogsDetail from '../../src/migrations/20260529130000_db_logs_detail';
import * as incomingTxsSender from '../../src/migrations/20260529140000_incoming_txs_sender';
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

// Kysely's FileMigrationProvider resolves each migration with a dynamic
// import() executed inside kysely itself. kysely is externalised, so that
// import never reaches the test runner's transform and is handled by Node's
// own ESM loader — which refuses a .ts file with `Unknown file extension
// ".ts"`. Node 24 hides this by stripping types natively; Node 22 (CI,
// Docker, the version this package targets) does not, so the suite passed
// locally and failed in CI.
//
// Importing them statically sidesteps the loader entirely. import.meta.glob
// would avoid the maintenance below, but this package compiles to CommonJS
// and tsc rejects import.meta under that module setting.
//
// ADDING A MIGRATION? Add it here too. migrations.spec.ts fails if you don't.
export const bundledMigrations: Record<string, Migration> = {
  '20260507000000_initial': initial,
  '20260519120000_webhooks': webhooks,
  '20260526120000_pending_broadcast': pendingBroadcast,
  '20260529130000_db_logs_detail': dbLogsDetail,
  '20260529140000_incoming_txs_sender': incomingTxsSender,
};

// Keys are the bare filenames the production FileMigrationProvider would
// produce; Kysely sorts on them to order the run.
const bundledMigrationProvider: MigrationProvider = {
  async getMigrations(): Promise<Record<string, Migration>> {
    return bundledMigrations;
  },
};

/**
 * Idempotent migration of the in-memory test DB. Each Vitest worker
 * gets its own better-sqlite3 `:memory:` connection, so migrating once
 * per worker is enough.
 */
export async function setupTestDb(): Promise<void> {
  if (migrated) return;
  await migrateToLatest(bundledMigrationProvider);
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
