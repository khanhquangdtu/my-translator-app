/**
 * Serves the production build to other devices on the LAN, over HTTPS.
 *
 *   npm run build && npm run start:lan
 *
 * Neither production entry point speaks TLS — `next start` takes only `--port`,
 * `--hostname` and `--keepAliveTimeout` — so HTTPS has to come from somewhere
 * else. A phone needs it: `getUserMedia`, service workers and installing the
 * PWA are all gated on a secure context, and http://192.168.x.x is not one.
 *
 * So the server is left alone on a loopback-only port and a TLS terminator sits
 * in front of it. The alternative — a custom server calling Next's request
 * handler directly — would replace the very thing this command exists to test.
 * Here the production server runs exactly as it does in the Dockerfile; only
 * the transport differs.
 *
 * That server is `.next/standalone/server.js`, not `next start`, because
 * `output: 'standalone'` is set and Next refuses the pairing outright:
 * `"next start" does not work with "output: standalone" configuration`.
 *
 * The certificate is the one `dev:lan` uses, and it pins the machine's LAN IP.
 * See scripts/lan.mjs for what happens when that IP changes.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import { printLan, CERT, KEY } from './lan.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const INTERNAL_PORT = Number(process.env.LAN_INTERNAL_PORT ?? PORT + 1);
const INTERNAL_HOST = '127.0.0.1';
const STANDALONE = '.next/standalone';

/*
 * The server prints its own "no production build" error, but only after the
 * TLS terminator has already bound a port and printed a URL that will never
 * answer. Failing first keeps the output honest.
 */
if (!existsSync(`${STANDALONE}/server.js`)) {
  console.error('[lan] no production build found — run `npm run build` first');
  process.exit(1);
}
for (const file of [CERT, KEY]) {
  if (!existsSync(file)) {
    console.error(`[lan] missing ${file} — generate it with mkcert (see npm run dev:lan)`);
    process.exit(1);
  }
}

/*
 * `standalone` carries the server and its dependency closure but not static
 * assets or public/ — the Dockerfile copies both in as separate layers, and
 * without them the page loads with every chunk 404ing. Same two copies here.
 */
cpSync('.next/static', `${STANDALONE}/.next/static`, { recursive: true });
cpSync('public', `${STANDALONE}/public`, { recursive: true });

/*
 * In Docker the secrets arrive as container environment. Here they are in
 * .env.local, which the standalone server never looks for: it resolves env
 * files against its own directory, and nothing copies them there. Without this
 * the page renders but every API route — Soniox token, summary, sessions —
 * fails on a missing key.
 *
 * Anything already exported wins, matching how Next ranks a real environment
 * variable above a file.
 */
const inherited = { ...process.env };
for (const file of ['.env', '.env.local']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const server = spawn(process.execPath, ['server.js'], {
  cwd: STANDALONE,
  env: { ...process.env, ...inherited, PORT: String(INTERNAL_PORT), HOSTNAME: INTERNAL_HOST },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write(`  next | ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`  next | ${d}`));
/*
 * Closing the listener and setting an exit code, rather than calling
 * process.exit: on Windows, exiting while the child's stdio pipes are still
 * tearing down aborts the process on a libuv assertion, which buries whatever
 * was actually being reported.
 */
let tls;
let gone = false;
server.on('exit', (code) => {
  gone = true;
  console.log(`[lan] server exited (${code})`);
  tls?.close(() => {});
  process.exitCode = code ?? 1;
});

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (gone) return false;
    try {
      // Any response proves the server is listening; the status does not matter.
      await fetch(`http://${INTERNAL_HOST}:${INTERNAL_PORT}/`);
      return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('the standalone server never became ready');
}

const proxy = (req, res) => {
  const upstream = http.request(
    {
      host: INTERNAL_HOST,
      port: INTERNAL_PORT,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        // Without these Next builds redirects and absolute URLs from the
        // loopback address it is bound to, sending the phone to a dead host.
        'x-forwarded-proto': 'https',
        'x-forwarded-host': req.headers.host ?? '',
        'x-forwarded-for': req.socket.remoteAddress ?? '',
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`upstream error: ${err.message}`);
  });

  req.pipe(upstream);
};

// False means the child died on its own — it has already said why, and there is
// nothing left to put a listener in front of.
if (await waitForServer()) {
  tls = https.createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, proxy);

  /*
   * Losing the bind is the one failure with an obvious cause and a useless
   * default: an unhandled 'error' event prints a libuv stack trace, and the
   * standalone server it already started stays behind holding the internal port,
   * so the retry fails differently.
   */
  tls.on('error', (err) => {
    console.error(
      err.code === 'EADDRINUSE'
        ? `[lan] port ${PORT} is already in use — stop the other server (npm run dev:lan?) or set PORT`
        : `[lan] ${err.message}`
    );
    server.kill();
    process.exitCode = 1;
  });

  tls.listen(PORT, '0.0.0.0', () => {
    console.log(
      `\n[lan] production build, https on 0.0.0.0:${PORT} → standalone server on ${INTERNAL_HOST}:${INTERNAL_PORT}`
    );
    printLan(PORT);
    console.log('');
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      tls.close();
      server.kill();
    });
  }
}
