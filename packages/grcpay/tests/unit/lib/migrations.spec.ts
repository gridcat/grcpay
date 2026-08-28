import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import path from 'path';
import { bundledMigrations } from '../../helpers/db';

// The test DB is migrated from a hand-maintained map (see helpers/db.ts —
// kysely's file-based provider cannot load .ts under the runner). A new
// migration that nobody adds to that map would simply never run in tests,
// and every suite would keep passing against a stale schema. Catch it here
// instead of in whatever spec happens to touch the new column first.
describe('test migration registry', () => {
  it('registers every migration in src/migrations', () => {
    const dir = path.join(__dirname, '../../../src/migrations');
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.replace(/\.ts$/, ''))
      .sort();

    expect(Object.keys(bundledMigrations).sort()).toEqual(onDisk);
  });

  it('exposes an up() for each registered migration', () => {
    for (const [name, migration] of Object.entries(bundledMigrations)) {
      expect(typeof migration.up, `${name}.up`).toBe('function');
    }
  });
});
