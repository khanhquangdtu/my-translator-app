/**
 * Session persistence — IndexedDB first, MongoDB behind it.
 *
 * This module presents exactly the API the Expo app's `storage/sessions.ts`
 * exported (`saveSession`, `readSession`, `listSessions`, `deleteSession`,
 * `attachSummary`, `updateSessionTitle`), so `useSession`, the Library screens
 * and the summary store call it without knowing anything moved. The record it
 * stores is byte-identical `SessionData`; only its address changed.
 *
 * **Why local-first rather than straight to the API.** Autosave runs every 15
 * seconds *during* a session, and the whole promise of the Stop dialog is that
 * the transcript already exists before the user decides anything. A write that
 * can fail on a train tunnel cannot carry that promise, so every write lands in
 * IndexedDB synchronously-ish and an outbox pushes it to the server whenever
 * the network allows.
 *
 * **Conflict rule.** Last write wins on `updatedAt`, and a row with a pending
 * outbox entry is never overwritten by a pull — otherwise a stale server copy
 * would resurrect a session the user just deleted, or undo an edit that has not
 * been flushed yet.
 */
'use client';

import { openDB, type IDBPDatabase } from 'idb';

import { ownerHeaders } from '@/lib/storage/deviceId';
import type { Summary } from '@/lib/summary/types';

import { summarize, type SessionData, type SessionSummary } from './format';

const DB_NAME = 'mytranslator';
const DB_VERSION = 1;
const SESSIONS = 'sessions';
const OUTBOX = 'outbox';

/**
 * `SessionData` is kept intact inside `data` rather than spread across the
 * record, so the JSON that reaches Mongo is the same JSON the desktop and
 * mobile builds write to disk.
 */
type StoredSession = {
  id: string;
  updatedAt: string;
  data: SessionData;
};

type OutboxEntry = {
  id: string;
  op: 'put' | 'delete';
  updatedAt: string;
};

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(SESSIONS)) {
        database.createObjectStore(SESSIONS, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(OUTBOX)) {
        database.createObjectStore(OUTBOX, { keyPath: 'id' });
      }
    },
  });
  return dbPromise;
}

// ─── Change notification ───────────────────────────────────────────────

/**
 * The Library refreshed on screen focus in the mobile build. Here a pull can
 * land at any moment, so screens subscribe instead and re-read when told to.
 */
const listeners = new Set<() => void>();

export function subscribeSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((l) => l());
}

// ─── The ported API surface ────────────────────────────────────────────

export async function saveSession(data: SessionData): Promise<void> {
  const updatedAt = new Date().toISOString();
  const database = await db();
  const tx = database.transaction([SESSIONS, OUTBOX], 'readwrite');
  await Promise.all([
    tx.objectStore(SESSIONS).put({ id: data.id, updatedAt, data } satisfies StoredSession),
    tx.objectStore(OUTBOX).put({ id: data.id, op: 'put', updatedAt } satisfies OutboxEntry),
    tx.done,
  ]);
  notify();
  void flush();
}

export async function readSession(id: string): Promise<SessionData | null> {
  const record = (await (await db()).get(SESSIONS, id)) as StoredSession | undefined;
  return record?.data ?? null;
}

/** Newest first — the Library reads top-down from the most recent session. */
export async function listSessions(): Promise<SessionSummary[]> {
  const records = (await (await db()).getAll(SESSIONS)) as StoredSession[];
  return records
    .map((r) => summarize(r.data))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function deleteSession(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction([SESSIONS, OUTBOX], 'readwrite');
  await Promise.all([
    tx.objectStore(SESSIONS).delete(id),
    tx
      .objectStore(OUTBOX)
      .put({ id, op: 'delete', updatedAt: new Date().toISOString() } satisfies OutboxEntry),
    tx.done,
  ]);
  notify();
  void flush();
}

export async function attachSummary(id: string, summary: Summary | null): Promise<void> {
  const data = await readSession(id);
  if (!data) return;
  data.summary = summary;
  await saveSession(data);
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  const data = await readSession(id);
  if (!data) return;
  data.title = title.trim().slice(0, 200);
  await saveSession(data);
}

// ─── Server sync ───────────────────────────────────────────────────────

let flushing = false;

/** Drains the outbox. Safe to call at any time; overlapping calls collapse. */
export async function flush(): Promise<void> {
  if (flushing || typeof navigator === 'undefined' || !navigator.onLine) return;
  flushing = true;
  try {
    const database = await db();
    const pending = (await database.getAll(OUTBOX)) as OutboxEntry[];

    for (const entry of pending) {
      try {
        if (entry.op === 'delete') {
          const response = await fetch(`/api/sessions/${encodeURIComponent(entry.id)}`, {
            method: 'DELETE',
            headers: ownerHeaders(),
          });
          // A 404 means the server never had it — the delete has still happened.
          if (!response.ok && response.status !== 404) continue;
        } else {
          const record = (await database.get(SESSIONS, entry.id)) as StoredSession | undefined;
          // Deleted after being queued; the delete entry will handle it.
          if (!record) {
            await database.delete(OUTBOX, entry.id);
            continue;
          }
          const response = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
            body: JSON.stringify({ updatedAt: record.updatedAt, data: record.data }),
          });
          if (!response.ok) continue;
        }
        await database.delete(OUTBOX, entry.id);
      } catch {
        // Network died mid-drain. Leave this and everything after it queued.
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

/**
 * Pulls the server's copy in. Rows with a pending local write are skipped —
 * the local edit has not reached the server yet, so the server's version is
 * knowingly stale and must not win.
 */
export async function pull(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return;

  let rows: StoredSession[];
  try {
    const response = await fetch('/api/sessions', { headers: ownerHeaders() });
    if (!response.ok) return;
    const body = (await response.json()) as { sessions?: StoredSession[] };
    rows = Array.isArray(body.sessions) ? body.sessions : [];
  } catch {
    return;
  }

  const database = await db();
  const pending = new Set(((await database.getAll(OUTBOX)) as OutboxEntry[]).map((e) => e.id));
  let changed = false;

  for (const row of rows) {
    if (!row?.id || !row.data) continue;
    if (pending.has(row.id)) continue;
    const local = (await database.get(SESSIONS, row.id)) as StoredSession | undefined;
    if (local && local.updatedAt >= row.updatedAt) continue;
    await database.put(SESSIONS, row);
    changed = true;
  }

  if (changed) notify();
}

/**
 * Wired up once from the app shell. Syncing on focus as well as on `online`
 * covers the phone case, where a backgrounded tab is frozen rather than
 * disconnected and never sees the event.
 */
export function startSync(): () => void {
  const run = () => {
    void flush().then(pull);
  };
  run();
  const onFocus = () => {
    if (document.visibilityState === 'visible') run();
  };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onFocus);
  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onFocus);
  };
}
