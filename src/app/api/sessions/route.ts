/**
 * Saved sessions, listed and upserted.
 *
 * The client is the source of truth for content — it writes to IndexedDB first
 * and pushes here from an outbox — so this endpoint is deliberately dumb: it
 * stores what it is given under an owner id and hands it back. Last write wins
 * on `updatedAt`, which is what the client's own merge assumes.
 */
import { NextResponse, type NextRequest } from 'next/server';

import type { SessionData } from '@/lib/sessions/format';
import { isMongoConfigured, sessions, type SessionRow } from '@/server/mongo';
import { OWNER_COOKIE, ownerOf } from '@/server/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unconfigured() {
  return NextResponse.json({ error: 'No database is configured.' }, { status: 503 });
}

function unidentified() {
  return NextResponse.json({ error: 'No device id.' }, { status: 400 });
}

/**
 * Every handler here talks to a database that may simply not be there. That is
 * a normal state for this app, not an exception: the client is local-first and
 * reads a failure as "stay offline and retry later". A 503 says that; an
 * unhandled throw would say 500, which reads as a bug in the request.
 */
async function withDatabase(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (err) {
    console.error('[api/sessions]', (err as Error)?.message);
    return NextResponse.json({ error: 'The database is unreachable.' }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  if (!isMongoConfigured()) return unconfigured();
  const ownerId = ownerOf(request);
  if (!ownerId) return unidentified();

  return withDatabase(async () => {
    const rows = await (await sessions())
      .find({ ownerId }, { projection: { _id: 0, ownerId: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    const response = NextResponse.json(
      { sessions: rows },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    response.cookies.set(OWNER_COOKIE, ownerId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365 * 5,
    });
    return response;
  });
}

export async function POST(request: NextRequest) {
  if (!isMongoConfigured()) return unconfigured();
  const ownerId = ownerOf(request);
  if (!ownerId) return unidentified();

  let body: { updatedAt?: unknown; data?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const data = body.data as SessionData | undefined;
  if (!data || typeof data.id !== 'string' || !data.id || typeof data.created_at !== 'string') {
    return NextResponse.json({ error: 'Not a session.' }, { status: 400 });
  }

  const updatedAt =
    typeof body.updatedAt === 'string' ? body.updatedAt : new Date().toISOString();

  const row: SessionRow = { ownerId, id: data.id, updatedAt, created_at: data.created_at, data };

  return withDatabase(async () => {
    await (await sessions()).replaceOne({ ownerId, id: data.id }, row, { upsert: true });
    return NextResponse.json({ ok: true, id: data.id, updatedAt });
  });
}
