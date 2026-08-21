/**
 * Integration tests for the session API, against a real MongoDB.
 *
 * These are the routes that replaced the desktop app's Rust storage layer, and
 * the client trusts three things about them that only a real database can
 * prove: an upsert of the same session id replaces rather than duplicates, one
 * owner never sees another's rows, and a delete actually removes the record —
 * the Stop dialog's promise depends on that last one.
 *
 * `mongodb-memory-server` downloads a mongod binary on first run. If it cannot
 * (no network, restricted CI), the suite skips rather than failing: these are
 * infrastructure tests, and a missing binary is not a broken app.
 */
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, describe, expect, it } from 'vitest';

import type { SessionData } from '@/lib/sessions/format';

/*
 * Started at module scope, not in `beforeAll`: `describe.skipIf` is evaluated
 * while the file is being collected, which is before any hook has run, so the
 * decision to skip has to be made here.
 */
let mongod: MongoMemoryServer | undefined;
try {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB = 'my_translator_test';
} catch (err) {
  console.warn(`[sessions.route.test] no mongod available, skipping: ${(err as Error).message}`);
}

// Imported after the env is set: `server/mongo.ts` reads MONGODB_URI lazily,
// but there is no reason to make that ordering subtle.
const { GET, POST } = mongod
  ? await import('./route')
  : ({} as typeof import('./route'));
const { GET: GET_ONE, DELETE: DELETE_ONE } = mongod
  ? await import('./[id]/route')
  : ({} as typeof import('./[id]/route'));

/** The `NextRequest` shape the handlers actually use: headers and cookies. */
function request(url: string, init: { deviceId?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (init.deviceId) headers.set('x-device-id', init.deviceId);
  return {
    headers,
    cookies: { get: () => undefined },
    json: async () => init.body,
    url,
  } as unknown as import('next/server').NextRequest;
}

const session = (id: string, title: string): SessionData => ({
  id,
  created_at: '2026-08-21T09:00:00.000Z',
  ended_at: '2026-08-21T09:30:00.000Z',
  title,
  engine: 'mock',
  source_lang: 'ja',
  target_lang: 'en',
  duration_sec: 1800,
  chunks: [
    {
      started_at: '2026-08-21T09:00:00.000Z',
      ended_at: '2026-08-21T09:30:00.000Z',
      segments: [{ ts: '00:04', src: 'ご参加ありがとう', tgt: 'Thanks for joining', speaker: 'spk-1' }],
    },
  ],
  speaker_names: { 'spk-1': 'Kenji' },
});

afterAll(async () => {
  await mongod?.stop();
});

describe.skipIf(!mongod)('/api/sessions', () => {
  it('rejects a request with no device id', async () => {
    const response = await GET(request('http://x/api/sessions'));
    expect(response.status).toBe(400);
  });

  it('stores a session and hands it back intact', async () => {
    const data = session('session-260821-090000', 'Q3 sales review');
    const posted = await POST(
      request('http://x/api/sessions', { deviceId: 'device-aaaa1111', body: { updatedAt: '2026-08-21T09:31:00.000Z', data } })
    );
    expect(posted.status).toBe(200);

    const listed = await GET(request('http://x/api/sessions', { deviceId: 'device-aaaa1111' }));
    const body = (await listed.json()) as { sessions: { id: string; data: SessionData }[] };
    expect(body.sessions).toHaveLength(1);
    // Byte-for-byte the record the mobile and desktop builds write to disk.
    expect(body.sessions[0].data).toEqual(data);
  });

  it('replaces rather than duplicating on a repeat upsert', async () => {
    const data = session('session-260821-090000', 'Renamed');
    await POST(
      request('http://x/api/sessions', { deviceId: 'device-aaaa1111', body: { updatedAt: '2026-08-21T10:00:00.000Z', data } })
    );

    const listed = await GET(request('http://x/api/sessions', { deviceId: 'device-aaaa1111' }));
    const body = (await listed.json()) as { sessions: { data: SessionData }[] };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].data.title).toBe('Renamed');
  });

  it('keeps one owner out of another owner"s sessions', async () => {
    const listed = await GET(request('http://x/api/sessions', { deviceId: 'device-bbbb2222' }));
    const body = (await listed.json()) as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(0);
  });

  it('refuses a body that is not a session', async () => {
    const response = await POST(
      request('http://x/api/sessions', { deviceId: 'device-aaaa1111', body: { data: { nope: true } } })
    );
    expect(response.status).toBe(400);
  });

  it('will not fetch another owner"s session by id', async () => {
    const params = Promise.resolve({ id: 'session-260821-090000' });
    const mine = await GET_ONE(request('http://x', { deviceId: 'device-aaaa1111' }), { params });
    expect(mine.status).toBe(200);

    const theirs = await GET_ONE(request('http://x', { deviceId: 'device-bbbb2222' }), { params });
    expect(theirs.status).toBe(404);
  });

  it('really deletes — the Stop dialog promises nothing is kept', async () => {
    const params = Promise.resolve({ id: 'session-260821-090000' });
    const deleted = await DELETE_ONE(request('http://x', { deviceId: 'device-aaaa1111' }), { params });
    expect(deleted.status).toBe(200);

    const listed = await GET(request('http://x/api/sessions', { deviceId: 'device-aaaa1111' }));
    const body = (await listed.json()) as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(0);

    // A second delete is a 404, which the outbox treats as success — the row is
    // gone either way, and retrying forever would be worse.
    const again = await DELETE_ONE(request('http://x', { deviceId: 'device-aaaa1111' }), { params });
    expect(again.status).toBe(404);
  });
});
