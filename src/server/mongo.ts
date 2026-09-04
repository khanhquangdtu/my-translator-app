/**
 * The MongoDB handle.
 *
 * One client per process, cached across hot reloads in development — Next
 * re-evaluates modules on every edit, and a fresh MongoClient per reload
 * exhausts the connection pool within a few saves.
 *
 * Indexes are created lazily on first use rather than in a migration step, so a
 * fresh deployment needs no setup beyond `MONGODB_URI`.
 */
import 'server-only';

import { MongoClient, type Collection, type Db } from 'mongodb';

import type { SessionData } from '@/lib/sessions/format';

/** One row per saved session, per owner. `data` is verbatim `SessionData`. */
export type SessionRow = {
  ownerId: string;
  id: string;
  updatedAt: string;
  created_at: string;
  data: SessionData;
};

/**
 * Admin-managed configuration. Exactly one row, `_id: 'providers'`.
 *
 * A single document rather than a row per provider: the admin page reads all of
 * them together on every load, and one document means one round trip and no
 * partial state to reason about mid-write.
 */
export type SettingsRow = {
  _id: string;
  updatedAt: string;
  /** Provider id -> sealed key. Absent id means "fall back to the environment". */
  providerKeys: Record<string, { iv: string; tag: string; data: string; updatedAt: string }>;
};

/**
 * One row per billable call the app makes, for providers that publish no usage
 * API of their own.
 *
 * Written on the response path and never read by anything user-facing, so a
 * failure to record must never fail the call it is recording — see
 * `recordUsage`.
 */
export type UsageEventRow = {
  provider: string;
  at: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Which endpoint spent it, so the admin page can attribute cost to a feature. */
  route: string;
};

const globalForMongo = globalThis as unknown as {
  _mongoClient?: Promise<MongoClient>;
  _mongoIndexed?: Promise<void>;
  _mongoUsageIndexed?: Promise<void>;
};

export function isMongoConfigured(): boolean {
  return !!process.env.MONGODB_URI;
}

function client(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  globalForMongo._mongoClient ??= new MongoClient(uri, {
    /*
     * The driver's default is 30 seconds, which is far too patient for this
     * app: every screen calls /api/sessions on mount, so an unreachable
     * database leaves those requests hanging rather than failing. The client
     * is local-first and treats an error as "stay offline, try again later",
     * so failing in three seconds is strictly better than succeeding in
     * thirty.
     */
    serverSelectionTimeoutMS: 3000,
    connectTimeoutMS: 3000,
  }).connect();
  return globalForMongo._mongoClient;
}

async function database(): Promise<Db> {
  try {
    return (await client()).db(process.env.MONGODB_DB || 'my_translator');
  } catch (err) {
    forgetFailedClient();
    throw err;
  }
}

/**
 * A failed connect leaves a rejected promise cached on `globalThis`, and every
 * later request would reuse it — the app would stay "offline" until the process
 * restarted, even after the database came back. Clearing it lets the next
 * request try again.
 */
function forgetFailedClient() {
  globalForMongo._mongoClient = undefined;
  globalForMongo._mongoIndexed = undefined;
}

export async function sessions(): Promise<Collection<SessionRow>> {
  const collection = (await database()).collection<SessionRow>('sessions');

  globalForMongo._mongoIndexed ??= (async () => {
    // One row per (owner, session): the upsert key.
    await collection.createIndex({ ownerId: 1, id: 1 }, { unique: true });
    // The Library's only query — newest first for one owner.
    await collection.createIndex({ ownerId: 1, created_at: -1 });
  })();

  try {
    await globalForMongo._mongoIndexed;
  } catch (err) {
    // Same reasoning as the client: a cached rejection would make the failure
    // permanent for the life of the process.
    forgetFailedClient();
    throw err;
  }

  return collection;
}

/**
 * The admin settings document.
 *
 * No index: the collection holds one row addressed by `_id`, which is indexed
 * by definition.
 */
export async function settings(): Promise<Collection<SettingsRow>> {
  return (await database()).collection<SettingsRow>('settings');
}

export async function usageEvents(): Promise<Collection<UsageEventRow>> {
  const collection = (await database()).collection<UsageEventRow>('usage_events');

  globalForMongo._mongoUsageIndexed ??= (async () => {
    // The admin dashboard's only query: one provider, newest first, windowed.
    await collection.createIndex({ provider: 1, at: -1 });
  })();

  try {
    await globalForMongo._mongoUsageIndexed;
  } catch (err) {
    // Same reasoning as `sessions`: a cached rejection would outlive the
    // outage that caused it.
    globalForMongo._mongoUsageIndexed = undefined;
    forgetFailedClient();
    throw err;
  }

  return collection;
}
