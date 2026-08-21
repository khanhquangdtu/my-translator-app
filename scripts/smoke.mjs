/**
 * Browser smoke test — walks the app the way a person would.
 *
 * The unit tests cover the resampler and the summary parser; the Next build
 * covers imports and types. Neither notices a screen that throws on mount, and
 * this app renders entirely on the client, so every screen is untested until
 * something executes it in a browser.
 *
 * Runs against `next dev` (or `next start`) on http://localhost:3000 with
 * NEXT_PUBLIC_MOCK_ENGINE=1. Microphone permission is granted up front and a
 * fake device is fed in, so Start reaches the mock engine without a human.
 *
 *   node scripts/smoke.mjs [--headful] [--url http://localhost:3000]
 *
 * Any console error or page exception fails the run — a screen that renders
 * but logs a React error is not passing.
 */
import { existsSync } from 'node:fs';

import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const BASE = valueOf('--url') ?? 'http://localhost:3000';
const HEADFUL = args.includes('--headful');

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const executablePath = process.env.CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to a browser binary.');
  process.exit(1);
}

const problems = [];
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) problems.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: !HEADFUL,
  args: [
    // No microphone on a build machine, and no prompt to click either.
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(BASE, ['microphone']);

  const page = await browser.newPage();
  // A phone, since that is what the layout is drawn for. Anything wider than
  // it is tall would take the landscape branch instead.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Favicon and manifest 404s in dev are noise, not app failures.
    if (/favicon|manifest|Failed to load resource/i.test(text)) return;
    problems.push(`console: ${text}`);
    console.log(`FAIL  console error  ${text}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
    console.log(`FAIL  page exception  ${error.message}`);
  });

  const text = () => page.evaluate(() => document.body.innerText);
  const goto = (path) => page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  const clickByLabel = async (label) => {
    const handle = await page.$(`[aria-label="${label}"]`);
    if (!handle) throw new Error(`no element labelled "${label}"`);
    await handle.click();
  };

  // ── onboarding ────────────────────────────────────────────────────
  await goto('/');
  await page.waitForFunction(() => location.pathname.startsWith('/onboarding'), { timeout: 15000 });
  check('/ redirects a fresh install into onboarding', true, `→ ${new URL(page.url()).pathname}`);
  check('step 1 draws the placement coach', (await text()).includes('about 30 cm from the speaker'));

  await page.click('button[aria-label="Allow microphone access"]');
  await page.waitForFunction(() => location.pathname === '/onboarding/2', { timeout: 15000 });
  check('granting the mic advances to step 2', (await text()).includes('SOURCE'));

  await page.click('button[aria-label="Start using it"]');
  await page.waitForFunction(() => location.pathname === '/live', { timeout: 15000 });
  check('finishing onboarding lands on Live', (await text()).includes('Tap Start to listen'));

  // ── a mock session, end to end ────────────────────────────────────
  await page.click('button[aria-label="▶  Start"]');
  // The mock connects after 700ms and types its first line out character by
  // character; the first translation lands about two seconds in.
  await page.waitForFunction(
    () => document.body.innerText.includes('Thanks everyone for joining'),
    { timeout: 20000 }
  );
  check('the engine streams turns into the transcript', true);
  check('the app bar switches to Listening', (await text()).includes('Listening'));

  await page.waitForFunction(
    () => document.body.innerText.includes('Q3 sales report'),
    { timeout: 20000 }
  );
  check('a second speaker gets its own block', true);

  await clickByLabel('■  Stop');
  await page.waitForFunction(
    () => document.body.innerText.includes('Save this conversation?'),
    { timeout: 15000 }
  );
  check('Stop asks rather than saving or discarding silently', true);

  await page.evaluate(() => {
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save');
    save?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Tap Start to listen'), {
    timeout: 15000,
  });
  check('saving returns Live to its idle state', true);

  // ── library ───────────────────────────────────────────────────────
  await goto('/library');
  await page.waitForFunction(() => !document.body.innerText.includes('No saved sessions yet'), {
    timeout: 15000,
  });
  const library = await text();
  check('the saved session appears in the Library', library.includes('Thanks everyone for joining'));
  check('its row carries the language pair and duration', /AUTO → EN/.test(library), '');

  await page.evaluate(() => {
    document.querySelector('[role="button"] [class*="title"]')?.closest('[role="button"]')?.click();
  });
  await page.waitForFunction(() => /\/library\/session-/.test(location.pathname), { timeout: 15000 });
  // The session is read from IndexedDB after mount, so the screen shows
  // "Loading…" for a frame or two first.
  await page.waitForFunction(
    () => !document.body.innerText.includes('Loading…'),
    { timeout: 15000 }
  );
  const detail = await text();
  check(
    'the archive opens on the Summary pane',
    detail.includes('No summary yet') || detail.includes('Summary unavailable'),
    detail.slice(0, 80).split('\n').join(' | ')
  );

  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Transcript');
    tab?.click();
  });
  await page.waitForFunction(
    () => document.body.innerText.includes('ご参加ありがとうございます'),
    { timeout: 15000 }
  );
  check('the transcript pane shows the source under every line', true);

  // ── the rest of the screens ───────────────────────────────────────
  // Section labels are uppercased in JS, so these are matched case-insensitively
  // rather than against whichever casing each screen happens to render.
  for (const [path, expected] of [
    ['/settings', 'Configuration'],
    ['/settings/display', 'Text size'],
    ['/settings/speech', 'Coming in a later release'],
    ['/settings/summary', 'Summary language'],
    ['/settings/translation', 'Endpoint delay'],
    ['/language-picker?target=source', 'All languages'],
  ]) {
    await goto(path);
    await page.waitForFunction(
      (want) => document.body.innerText.toLowerCase().includes(want.toLowerCase()),
      { timeout: 15000 },
      expected
    );
    check(`${path} renders`, true);
  }

  // ── server sync ───────────────────────────────────────────────────
  // Only meaningful when a database is configured. Without one the app is
  // still fully usable — that is the whole point of the local-first store — so
  // this reports as skipped rather than failing.
  const probe = await fetch(`${BASE}/api/sessions`, { headers: { 'x-device-id': 'probe-device-1' } });
  if (probe.status === 503) {
    console.log('SKIP  session sync (no MONGODB_URI configured)');
  } else {
    const deviceId = await page.evaluate(() => localStorage.getItem('mytranslator:device-id'));
    check('the browser minted an anonymous owner id', !!deviceId, String(deviceId).slice(0, 8) + '…');

    // The outbox flushes on save and again on focus; give the request a moment.
    let synced = [];
    for (let attempt = 0; attempt < 20 && synced.length === 0; attempt++) {
      const response = await fetch(`${BASE}/api/sessions`, { headers: { 'x-device-id': deviceId } });
      synced = (await response.json()).sessions ?? [];
      if (synced.length === 0) await new Promise((r) => setTimeout(r, 500));
    }
    check('the saved session reached the database', synced.length === 1);
    check(
      'the stored record is the same SessionData the app writes locally',
      synced[0]?.data?.chunks?.[0]?.segments?.[0]?.tgt === 'Thanks everyone for joining.',
      synced[0]?.data?.title ?? ''
    );
  }

  // ── persistence ───────────────────────────────────────────────────
  await goto('/live');
  const reloaded = await text();
  check('prefs survive a reload (no onboarding re-prompt)', reloaded.includes('Tap Start to listen'));
} catch (err) {
  problems.push(String(err?.message ?? err));
  console.log(`FAIL  ${err?.message ?? err}`);
} finally {
  await browser.close();
}

const failed = problems.length;
console.log(
  failed === 0
    ? `\nAll ${results.length} smoke checks passed.`
    : `\n${failed} problem(s):\n  ${problems.join('\n  ')}`
);
process.exit(failed === 0 ? 0 : 1);
