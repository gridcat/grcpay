import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // Vitest 4 dropped **/dist/** from defaultExclude; without this a
    // stale build gets collected alongside the sources.
    exclude: ['node_modules/**', 'dist/**'],
    // Populates NETWORK/DATABASE_URL/RPC creds before src/config.ts
    // runs its startup validation at import time.
    setupFiles: ['./tests/setEnv.ts'],
    globals: false,
  },
});
