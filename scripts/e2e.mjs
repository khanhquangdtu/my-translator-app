/**
 * The whole stack, once, on one command.
 *
 * Boots an in-memory MongoDB, starts the Next server against it with the mock
 * engine on, runs the browser smoke test, and tears everything down. This is
 * the only check that exercises the full path the app actually takes — browser
 * → IndexedDB → outbox → API route → MongoDB — which is the part that replaced
 * the desktop build's Rust storage layer.
 *
 *   node scripts/e2e.mjs
 *
 * Needs a Chrome or Edge on the machine (or CHROME_PATH), and downloads a
 * mongod binary the first time.
 */
import { spawn } from 'node:child_process';

import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = process.env.PORT ?? '3100';
const BASE = `http://localhost:${PORT}`;

const mongod = await MongoMemoryServer.create();
console.log(`mongod  ${mongod.getUri()}`);

const server = spawn('npx', ['next', 'dev', '--port', PORT], {
  env: {
    ...process.env,
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'my_translator_e2e',
    NEXT_PUBLIC_MOCK_ENGINE: '1',
  },
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write(`  next | ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`  next | ${d}`));

async function waitForServer(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/config`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the dev server never became ready');
}

let code = 1;
try {
  await waitForServer();
  console.log(`\nserver ready at ${BASE}\n`);

  code = await new Promise((resolve) => {
    const smoke = spawn('node', ['scripts/smoke.mjs', '--url', BASE], { stdio: 'inherit' });
    smoke.on('exit', (c) => resolve(c ?? 1));
  });
} catch (err) {
  console.error(err.message);
} finally {
  server.kill();
  await mongod.stop();
}

process.exit(code);
