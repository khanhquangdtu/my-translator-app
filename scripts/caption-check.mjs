/**
 * Does real speech actually become captions?
 *
 * `soniox-check.mjs` proves the socket comes up; this proves the whole pipe,
 * by feeding Chrome a WAV of real speech as its microphone
 * (`--use-file-for-fake-audio-capture`, which loops the file) and waiting for a
 * turn to appear on screen.
 *
 * It prints every relevant console line as it goes, so when nothing appears the
 * output says *where* it stopped: no audio blocks, audio but no socket, socket
 * but no tokens, or tokens that never reached the UI.
 *
 *   npm run dev            # in one shell, with a real SONIOX_API_KEY
 *   node scripts/caption-check.mjs [--wav .speech-test.wav] [--seconds 30]
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import puppeteer from 'puppeteer-core';

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const BASE = arg('--url', 'http://localhost:3000');
const WAV = resolve(arg('--wav', '.speech-test.wav'));
const SECONDS = Number(arg('--seconds', '30'));
/** Overrides the saved prefs, so a specific language pair can be reproduced. */
const SOURCE = arg('--source', undefined);
const TARGET = arg('--target', undefined);

if (!existsSync(WAV)) {
  console.error(`No WAV at ${WAV}. Generate one first (see README).`);
  process.exit(1);
}

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
];
const executablePath = process.env.CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome found. Set CHROME_PATH.');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    // Chrome loops this file as the microphone. 16-bit PCM WAV only.
    `--use-file-for-fake-audio-capture=${WAV}`,
  ],
});

let captioned = false;

try {
  await browser.defaultBrowserContext().overridePermissions(BASE, ['microphone']);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[audio]') || t.includes('[soniox]') || m.type() === 'error') {
      console.log(`  console  ${t.slice(0, 160)}`);
    }
  });
  page.on('pageerror', (e) => console.log(`  pageerror  ${e.message}`));

  // Watch the actual WebSocket, so "Soniox said nothing" and "the UI dropped
  // it" cannot be confused for each other. Filtered by URL: in dev, Next's own
  // HMR socket is on the same page and its frames would drown out the signal.
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  const sonioxSockets = new Set();
  let framesIn = 0;
  let framesOut = 0;
  let bytesOut = 0;
  const notable = [];

  /*
   * Latency marks, all relative to the first audio frame that left the browser.
   *
   * The pass/fail check below polls the DOM once a second, which is fine for
   * "did a caption appear at all" and useless for the thing actually being
   * optimised — the interesting numbers here are all under a second. These
   * marks come from the CDP WebSocket events and a MutationObserver instead, so
   * they can distinguish the four stages that used to be one opaque wait:
   * audio out, first recognised word back, first *translated* word back, and
   * the translation on screen.
   *
   * `firstTranslationFinal` is the one to watch across an endpoint-delay
   * change: it is gated by Soniox deciding the utterance ended, where
   * `firstTranslationPartial` is not.
   */
  const mark = {
    firstAudioSent: null,
    firstTokenAny: null,
    firstOriginalPartial: null,
    firstTranslationPartial: null,
    firstTranslationFinal: null,
  };
  const at = () => Date.now();
  const since = (t) => (t === null || mark.firstAudioSent === null ? null : t - mark.firstAudioSent);
  cdp.on('Network.webSocketCreated', ({ requestId, url }) => {
    if (url.includes('soniox')) {
      sonioxSockets.add(requestId);
      console.log(`  ws open  ${url}`);
    }
  });
  cdp.on('Network.webSocketFrameSent', ({ requestId, response }) => {
    if (!sonioxSockets.has(requestId)) return;
    framesOut++;
    bytesOut += response.payloadData.length;
    // The config frame goes out first and is text; audio is the binary that
    // follows, and that is what the clock should start on.
    if (mark.firstAudioSent === null && framesOut > 1) mark.firstAudioSent = at();
    if (framesOut <= 1) {
      // Redact the key before it reaches a terminal or a log file.
      const config = response.payloadData.replace(/("api_key":")[^"]+/, '$1«redacted»');
      console.log(`  ws sent  config: ${config.slice(0, 500)}`);
    }
  });
  cdp.on('Network.webSocketFrameReceived', ({ requestId, response }) => {
    if (!sonioxSockets.has(requestId)) return;
    framesIn++;
    const text = response.payloadData;
    if (!text.startsWith('{')) return;
    try {
      const data = JSON.parse(text);
      if (data.error_code) {
        notable.push(`ERROR ${data.error_code}: ${data.error_message}`);
        console.log(`  ws recv  ERROR ${data.error_code}: ${data.error_message}`);
      } else if (data.tokens?.length) {
        if (mark.firstTokenAny === null) mark.firstTokenAny = at();
        for (const t of data.tokens) {
          if (!t.text || t.text === '<end>') continue;
          if (t.translation_status === 'translation') {
            if (!t.is_final && mark.firstTranslationPartial === null)
              mark.firstTranslationPartial = at();
            if (t.is_final && mark.firstTranslationFinal === null)
              mark.firstTranslationFinal = at();
          } else if (!t.is_final && mark.firstOriginalPartial === null) {
            mark.firstOriginalPartial = at();
          }
        }
        const preview = data.tokens
          .map((t) => `${t.text}${t.is_final ? '*' : ''}[${t.translation_status ?? '-'}]`)
          .join('');
        notable.push(preview);
        if (notable.length <= 12) console.log(`  ws recv  ${preview.slice(0, 160)}`);
      }
    } catch {
      // not our frame
    }
  });

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(
    (source, target) => {
      const raw = localStorage.getItem('mytranslator:prefs');
      const prefs = raw ? JSON.parse(raw) : {};
      prefs.onboarded = true;
      if (source) prefs.sourceLanguage = source;
      if (target) prefs.targetLanguage = target;
      localStorage.setItem('mytranslator:prefs', JSON.stringify(prefs));
    },
    SOURCE,
    TARGET
  );
  await page.goto(`${BASE}/live`, { waitUntil: 'networkidle0' });

  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mytranslator:prefs') ?? '{}')
  );
  console.log(
    `\nlanguages          source=${settings.sourceLanguage ?? 'auto'}  target=${settings.targetLanguage ?? 'auto'}  navigator=${await page.evaluate(() => navigator.language)}`
  );
  console.log(`wav                ${WAV}\n`);

  /*
   * Stamp the moment a caption actually reaches the screen.
   *
   * The loop below still polls once a second to decide pass/fail, which is all
   * it ever needed to do. But a one-second poll cannot measure a change worth a
   * few hundred milliseconds, so the timestamp comes from a MutationObserver
   * installed before Start: it fires on the mutation itself, and the poll only
   * has to notice, later and lazily, that it already happened.
   */
  await page.evaluate(() => {
    window.__captionAt = null;
    const settled = () => {
      const text = document.body.innerText;
      return !text.includes('Listening…') && !text.includes('Tap Start to listen');
    };
    const observer = new MutationObserver(() => {
      if (window.__captionAt === null && settled()) {
        window.__captionAt = Date.now();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  await page.click('button[aria-label="▶  Start"]');
  console.log('started, listening…\n');

  const deadline = Date.now() + SECONDS * 1000;
  while (Date.now() < deadline) {
    const body = await page.evaluate(() => document.body.innerText);
    // Anything past the chrome means a turn or a provisional line landed.
    if (!body.includes('Listening…') && !body.includes('Tap Start to listen')) {
      captioned = true;
      console.log('\n─── caption on screen ───');
      console.log(body.split('\n').filter(Boolean).slice(0, 25).join('\n'));
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\nws frames          sent=${framesOut} (${Math.round(bytesOut / 1024)} KB audio)  received=${framesIn}`);
  console.log(`token frames       ${notable.length}`);

  // Everything below is measured from the first audio frame. Compare runs
  // rather than absolute numbers: the WAV loops, so where speech begins inside
  // it differs from run to run.
  const captionAt = await page.evaluate(() => window.__captionAt ?? null);
  const ms = (v) => (v === null ? '       -' : `${String(v).padStart(6)}ms`);
  console.log('\n--- latency from first audio frame ---');
  console.log(`  any token back        ${ms(since(mark.firstTokenAny))}`);
  console.log(`  source, partial       ${ms(since(mark.firstOriginalPartial))}`);
  console.log(`  translation, partial  ${ms(since(mark.firstTranslationPartial))}   <- live preview`);
  console.log(`  translation, final    ${ms(since(mark.firstTranslationFinal))}   <- gated by endpoint delay`);
  console.log(`  caption on screen     ${ms(since(captionAt))}`);
  if (mark.firstTranslationPartial === null && mark.firstTranslationFinal !== null) {
    console.log('\n  No partial translation seen - the live preview is not reaching the UI.');
  }
  if (!captioned) {
    console.log('\nNo caption appeared. Read the counters above:');
    console.log('  sent=0            audio never reached the socket');
    console.log('  sent>0 received=0 Soniox got audio and said nothing back');
    console.log('  token frames>0    Soniox recognised speech but the UI dropped it');
  }

  await page.click('button[aria-label="■  Stop"]');
} catch (err) {
  console.log(`FAILED — ${err.message}`);
} finally {
  await browser.close();
}

process.exit(captioned ? 0 : 1);
