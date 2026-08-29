import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every suite talks to the same Postgres database, so they must not run
    // concurrently — one file's cleanup would delete another's fixtures.
    fileParallelism: false,
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
