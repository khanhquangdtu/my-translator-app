import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
       * `server-only`'s default entry throws on import — that is the whole
       * point of the package, and it is what keeps `server/openai.ts` out of
       * the browser bundle. Under the test runner there is no server/client
       * boundary to enforce, so it resolves to the no-op entry Next itself uses
       * on the server. The guard still applies where it matters: the Next
       * build, which is what would ship the key.
       */
      'server-only': fileURLToPath(
        new URL('./node_modules/server-only/empty.js', import.meta.url)
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The Mongo suite downloads and boots a mongod on first run.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
