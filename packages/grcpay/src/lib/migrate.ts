import path from 'path';
import { promises as fs } from 'fs';
import { Migrator, FileMigrationProvider } from 'kysely';
import type { MigrationProvider } from 'kysely';
import { db } from './db';
import { log } from './log';

// Boot-time migration runner. Pointed at the same src/migrations
// folder bundled into the dist/ tree at build time. Safe to call from
// the app entrypoint because Kysely uses kysely_migration_lock to
// serialize concurrent runners. Does not destroy the connection — the
// long-running app keeps using it.
// `provider` is only ever passed by the test helper. FileMigrationProvider
// import()s each migration by absolute path from inside kysely, which is
// externalised — so that import bypasses the test runner's transform and
// lands on Node's own ESM loader, which cannot read a .ts file. Production
// always runs the compiled dist/*.js, so the default is unaffected.
export async function migrateToLatest(provider?: MigrationProvider): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: provider ?? new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, '..', 'migrations'),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((r) => {
    if (r.status === 'Success') {
      log.info(`[migrate] applied ${r.migrationName}`);
    } else if (r.status === 'Error') {
      log.error(`[migrate] failed ${r.migrationName}`);
    }
  });

  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
