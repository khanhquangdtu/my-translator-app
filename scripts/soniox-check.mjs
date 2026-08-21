/**
 * Does the real Soniox stream actually come up?
 *
 * `npm run e2e` proves every screen works, but it runs on the mock engine —
 * which means the one thing it cannot tell you is whether the token → socket →
 * config-frame handshake works against the live service. This does exactly that
 * and nothing more: Start, wait for the engine to report connected, let audio
 * flow for a few seconds, Stop.
 *
 * Chrome's fake capture device emits a tone, not speech, so **no transcript is
 * expected** — Soniox will hear a 440 Hz beep and correctly return nothing.
 * What is being checked is the connection, the audio path, and the absence of
 * an error banner. Real words still need a real microphone.
 *
 * Costs a few seconds of Soniox session time. Needs SONIOX_API_KEY set and the
 * mock engine off.
 *
 *   npm run dev            # in one shell
 *   node scripts/soniox-check.mjs
 */
import { existsSync } from 'node:fs';

import puppeteer from 'puppeteer-core';

const BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:3000';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
];
const executablePath = process.env.CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome or Edge found. Set CHROME_PATH.');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

let failed = false;
const line = (label, value) => console.log(`${label.padEnd(19)}${value}`);

try {
  await browser.defaultBrowserContext().overridePermissions(BASE, ['microphone']);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  const logs = [];
  page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: e.message }));

  // Skip onboarding — this is about the engine, not the flow.
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const raw = localStorage.getItem('mytranslator:prefs');
    const prefs = raw ? JSON.parse(raw) : {};
    prefs.onboarded = true;
    localStorage.setItem('mytranslator:prefs', JSON.stringify(prefs));
  });
  await page.goto(`${BASE}/live`, { waitUntil: 'networkidle0' });

  const tokenCall = page.waitForResponse((r) => r.url().endsWith('/api/soniox/token'), {
    timeout: 20_000,
  });
  await page.click('button[aria-label="▶  Start"]');
  line('token request', `${(await tokenCall).status()}`);

  await page.waitForFunction(() => document.body.innerText.includes('Listening'), {
    timeout: 25_000,
  });
  line('engine status', 'connected — the app bar reads "Listening"');

  await new Promise((r) => setTimeout(r, 6000));

  const body = await page.evaluate(() => document.body.innerText);
  const banner = /Connection dropped|Invalid|Rate limit|Out of credit|Configuration error/i.exec(
    body
  );
  line('error banner', banner ? `PRESENT → ${banner[0]}` : 'none');
  if (banner) failed = true;

  const rate = logs.find((l) => l.text.includes('AudioContext running at'));
  line('audio', rate ? rate.text.replace('[audio] ', '') : 'no rate logged — capture never started');
  if (!rate) failed = true;

  // The signal probe is dev-only by design (see capture.ts), so a production
  // build legitimately reports nothing here.
  const signal = logs.filter((l) => l.text.includes('[audio] peak=')).pop();
  line(
    'signal',
    signal
      ? signal.text.replace('[audio] ', '')
      : 'not logged — the probe is dev-only, and this looks like a production build'
  );

  await page.click('button[aria-label="■  Stop"]');
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('Tap Start') ||
      document.body.innerText.includes('Save this conversation?'),
    { timeout: 15_000 }
  );
  line('stop', 'clean');

  const bad = logs
    .filter((l) => l.type === 'error' || l.type === 'pageerror')
    // A 503 from /api/sessions is the expected answer when no database is
    // configured, and this script is about the engine, not the store.
    .filter((l) => !/Failed to load resource/i.test(l.text));
  line('console errors', bad.length === 0 ? 'none' : bad.map((b) => b.text).join(' | '));
  if (bad.length) failed = true;
} catch (err) {
  console.log(`FAILED — ${err.message}`);
  failed = true;
} finally {
  await browser.close();
}

console.log(failed ? '\nSoniox check FAILED' : '\nSoniox stream came up cleanly.');
process.exit(failed ? 1 : 0);
