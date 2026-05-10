import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Database as Schema } from './database';
import { config } from '../config';

// DATABASE_URL accepts either a Prisma-style `file:...` URL (kept for
// drop-in compatibility with deployments that still ship the old
// schema.prisma value) or a raw filesystem path, plus the special
// `:memory:` sentinel for tests. Anything starting with `file:` is
// treated as a path relative to the package root, matching how Prisma
// resolved its own SQLite paths.
function resolveSqlitePath(url: string): string {
  if (url === ':memory:' || url === 'file::memory:' || url === 'file:memory:') {
    return ':memory:';
  }
  let raw = url.startsWith('file:') ? url.slice('file:'.length) : url;
  // Old Prisma config used `file:../data/payment.db` which resolved
  // relative to prisma/schema.prisma — i.e. one level up to the
  // package root, into ./data. Strip a leading `../` to land in the
  // same place when running from the package root directly.
  if (raw.startsWith('../')) {
    raw = raw.slice(3);
  }
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(process.cwd(), raw);
}

const sqlitePath = resolveSqlitePath(config.DATABASE_URL);

if (sqlitePath !== ':memory:') {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
}

const sqlite = new Database(sqlitePath);

// safeIntegers makes every INTEGER column come back as a JS bigint, so
// halford amounts (1 GRC = 100_000_000 halford) read at full 64-bit
// precision. Wallet.fromRow narrows the few small-integer columns
// (id, refund_attempts, lifespan_seconds) back to Number where the app
// expects them.
sqlite.defaultSafeIntegers(true);

// WAL gives us concurrent readers (the grc-control panel volume-mounts
// payment.db read-only and runs its own queries) without blocking
// grcpay's writers. NORMAL synchronous is the standard pairing for WAL.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
// Wait up to 5s on a competing writer before throwing SQLITE_BUSY.
// Single-process app + single read-only sibling means contention is
// rare, but the timeout protects against the rare overlap.
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');

export const db = new Kysely<Schema>({
  dialect: new SqliteDialect({ database: sqlite }),
});

// JSON.stringify can't natively serialize BigInt. Halford amounts and
// row IDs are BigInt at runtime; both are safe to send as decimal
// strings on the wire. Register a process-wide toJSON so route
// handlers don't need to call .toString() on every BigInt field.
// eslint-disable-next-line no-extend-native, @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function toJSON(this: bigint) {
  return this.toString();
};

// Returns the current instant as the canonical ISO-8601 string used
// for every datetime column in the schema. App always supplies these —
// the schema has no DEFAULT CURRENT_TIMESTAMP — so the format stays
// uniform and lexicographic comparisons in SQL stay correct.
export function now(): string {
  return new Date().toISOString();
}
