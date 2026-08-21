# My Translator — PWA

Real-time speech translation in the browser. Put the phone down near whoever is
talking, tap **Start**, and read the translation as it arrives.

A web port of [`rovato`](../rovato), the Expo/React Native build, matching it
screen for screen. Next.js 15 App Router, client-rendered, installable as a PWA.

> The Expo app was itself a rewrite of the `my-translator` Tauri desktop app.
> What the desktop kept in Rust — provider credentials, the session store — lives
> in Next API routes here.

---

## How this differs from the mobile build

Three deliberate changes. Everything else is a port.

| | rovato (Expo) | this |
|---|---|---|
| **Provider keys** | inlined into the app bundle, and the code says so | server-only. The browser gets a 60-second Soniox key from `/api/soniox/token`; OpenAI is never reached from the client at all |
| **Transcripts** | files on the device, nowhere else | IndexedDB first, then synced to MongoDB through an outbox |
| **Owner** | not a concept — one phone, one set of files | an anonymous `deviceId` minted in the browser, sent as a header. No login screen was added |

The second one changes a user-facing promise, so the copy changed with it:
Settings › Privacy now reads *"keys never leave the server"*, and the Save
dialog no longer says the transcript stays on this device.

---

## Running it

```bash
npm install
cp .env.example .env.local     # fill in what you have
npm run dev
```

Coming from the Expo build, the keys are the same but the names are not:

| rovato `.env` | here `.env.local` |
|---|---|
| `EXPO_PUBLIC_SONIOX_KEY` | `SONIOX_API_KEY` |
| `EXPO_PUBLIC_OPENAI_KEY` | `OPENAI_API_KEY` |

Dropping the `EXPO_PUBLIC_` / `NEXT_PUBLIC_` prefix is the entire point: a
prefixed variable is inlined into the browser bundle, which is what the mobile
build's `config/credentials.ts` carried a warning about. Nothing in this app
should ever put a provider key behind `NEXT_PUBLIC_`.

Nothing is required to boot. With no keys and no database the app still runs —
it just cannot start a session, and sessions live only in the browser.

| variable | what it unlocks | without it |
|---|---|---|
| `SONIOX_API_KEY` | live translation | Start reports a configuration error |
| `OPENAI_API_KEY` | AI summaries | the Summary pane says "unavailable"; transcripts are unaffected |
| `MONGODB_URI` | sync across devices | the Library works from IndexedDB and the outbox never drains |
| `NEXT_PUBLIC_MOCK_ENGINE=1` | a scripted JA→EN meeting | — |

`NEXT_PUBLIC_MOCK_ENGINE=1` is how to walk the whole app without a Soniox key
or a microphone. It replays five turns across three speakers, typing each one
out character by character, which is enough to exercise every state on Live.

**Microphone capture needs a secure context** — `https://` or `localhost`. On a
LAN address over plain HTTP `navigator.mediaDevices` does not exist at all, and
Start fails with "Could not open the microphone".

**`next dev` cannot reuse a `next build`.** They share `.next` and write
incompatible things into it; starting dev after a build gives a page that 500s
with `ENOENT: .next/server/app/page.js`, an error that names nothing useful.
`npm run dev` guards against this — `predev` clears a production `.next` when it
finds one — but if you invoke `next dev` directly, delete `.next` first.

---

## Docker

```bash
docker compose up -d                  # MongoDB alone — the usual case
docker compose --profile app up -d --build   # MongoDB + the app
docker compose down                   # stop; saved sessions survive
docker compose down -v                # stop and erase the database
```

The default brings up **only MongoDB**, because that is what local development
needs: the app runs on the host with `npm run dev` — hot reload, and the
microphone works because `localhost` is a secure context — while its database
lives in the container. Point `.env.local` at it with:

```
MONGODB_URI=mongodb://127.0.0.1:27017
```

`--profile app` additionally builds and runs the app itself from `Dockerfile`
(multi-stage, Next's `standalone` output, non-root, ~340 MB). Inside the compose
network it reaches the database at `mongodb://mongo:27017`, which
`docker-compose.yml` sets explicitly so it wins over whatever `.env.local` says.

Nothing secret is baked into the image: `.dockerignore` excludes `.env*`, and the
provider keys are injected at run time from `.env.local` via `env_file`. The one
build-time value is `NEXT_PUBLIC_MOCK_ENGINE`, because `NEXT_PUBLIC_*` is inlined
into the browser bundle by definition — which is precisely why no provider key
may ever carry that prefix:

```bash
NEXT_PUBLIC_MOCK_ENGINE=1 docker compose --profile app up -d --build
```

The compose project is named `my-translator-pwa`, not `my-translator`: the Tauri
desktop app next door owns that name, and sharing it makes each project treat
the other's containers as orphans.

---

## Layout

```
src/
├── app/                    routes (every page is 'use client')
│   ├── live/               the whole app: idle, listening, degraded, table mode
│   ├── library/            session history, and [id] for the archive
│   ├── settings/           translation · speech · summary · display
│   ├── onboarding/[step]/  placement coach + default languages
│   ├── language-picker/    presented as a modal
│   └── api/
│       ├── soniox/token/   mints a short-lived STT key
│       ├── summary/        proxies OpenAI, holding the key
│       ├── sessions/       list + upsert, per owner
│       └── config/         two booleans: is each key configured
├── components/             primitives, dialogs, sheet, transcript, meters
├── lib/
│   ├── audio/              capture (AudioWorklet) · level · resample
│   ├── engine/             Soniox WebSocket · mock · the token fetch
│   ├── sessions/           format (pure) · store (IndexedDB + outbox)
│   ├── platform/           wake lock · clipboard · share · orientation
│   └── config/             what this deployment can do
├── server/                 mongo · openai · owner resolution
├── state/                  liveStore · settingsStore · summaryStore · useSession
└── theme/                  tokens.ts and its CSS mirror
```

**Most of `lib/` and all of `state/` is the mobile code, unchanged.** The
resampler, the Soniox protocol handling, the FIFO turn pairing, the session
lifecycle, the defensive summary parsing — all ported rather than rewritten,
which is why the landmines below read the same as the mobile app's.

The UI is a rewrite: plain React and CSS Modules driven by `theme/tokens.ts`,
not `react-native-web`. `tokens.css` mirrors the same values so both halves
agree; change one and you must change the other.

---

## Before saying a change works

```bash
npm run typecheck && npm run lint && npm test
npm run build          # catches route and import errors
npm run e2e            # the whole stack, in a real browser
```

`npm test` is vitest: the resampler's drift and pitch, the OpenAI request shape
and its defensive parsing, and the session API against a real MongoDB
(`mongodb-memory-server` downloads a mongod the first time; the suite skips
itself if it cannot).

`npm run caption` is the end-to-end proof that speech becomes captions: it feeds
Chrome a WAV as its microphone (`--use-file-for-fake-audio-capture`) and waits
for a turn to appear, printing the Soniox WebSocket traffic as it goes. When
nothing appears, the counters say where it stopped — no audio blocks, audio but
no socket, socket but no tokens, or tokens the UI dropped. Generate a sample
with Windows' own TTS:

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, 'Sixteen', 'Mono')
$s.SetOutputToWaveFile("$PWD\.speech-test.wav", $fmt)
$s.Speak("Revenue is up twelve percent year over year.")
$s.Dispose()
```

```bash
npm run caption -- --wav .speech-test.wav --target en
```

`npm run soniox` is the one check that touches the live service: it opens Live
in Chrome with a fake capture device, presses Start, and asserts the token →
WebSocket → `connected` path comes up with no error banner. Chrome's fake device
emits a tone rather than speech, so no transcript is expected — this proves the
connection, not the recognition. It costs a few seconds of session time.

`npm run e2e` boots an in-memory MongoDB, starts the dev server against it with
the mock engine, and drives Chrome through onboarding → a session → save →
Library → the archive → every settings screen, asserting the saved session
reaches the database with its `SessionData` intact. Any console error or page
exception fails the run. `npm run smoke` does the same against a server you
started yourself (`--headful` to watch it).

Only `npm run soniox` needs a key; the rest runs on the mock engine. Anything
touching **real speech or the 3-minute rollover still needs a real run** — say
so plainly rather than implying it was verified.

---

## Landmines

Mostly inherited, because the code is.

- **Audio sample rate.** A browser `AudioContext` runs at 44100 or 48000 on
  nearly every machine; asking for 16000 is a hint it may ignore. Soniox will
  not complain about the mismatch — it returns fluent nonsense. `audio/capture.ts`
  logs the real rate once per change; check it before debugging anything upstream.
- **Turn pairing.** Source and translation arrive as two uncorrelated streams and
  are matched FIFO in `state/liveStore.ts`. Changing that ordering silently
  scrambles transcripts.
- **3-minute session rollover** in `engine/soniox.ts` is make-before-break, and
  now also has to fetch a fresh token mid-flight. Any edit there must be tested
  with a session longer than three minutes.
- **Summary requests.** The gpt-5 family rejects `max_tokens` (use
  `max_completion_tokens`) and refuses a custom `temperature`. A model can
  satisfy a JSON schema and still return the wrong types, so keep the defensive
  parsing in `server/openai.ts`.
- **Never add an API-key field.** Credentials are server-side environment
  variables. The browser learns only whether they exist, from `/api/config`.
- **Stop is a decision point**, not a save. `useSession.discardSession()` must
  delete what autosave already wrote — locally *and* on the server. The dialog
  promises nothing is kept.
- **`/api/*` is never cached** by the service worker. A stale session list or a
  replayed summary is worse than an error.
