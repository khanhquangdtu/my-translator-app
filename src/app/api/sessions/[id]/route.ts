/**
 * A single saved session.
 *
 * DELETE is the one that matters: the Stop dialog promises that discarding
 * keeps nothing, and by then autosave has already pushed the session here.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isMongoConfigured, sessions } from '@/server/mongo';
import { ownerOf } from '@/server/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

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

export async function GET(request: NextRequest, { params }: Params) {
  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'No database is configured.' }, { status: 503 });
  }
  const ownerId = ownerOf(request);
  if (!ownerId) return NextResponse.json({ error: 'No device id.' }, { status: 400 });

  const { id } = await params;
  return withDatabase(async () => {
    const row = await (await sessions()).findOne(
      { ownerId, id },
      { projection: { _id: 0, ownerId: 0 } }
    );
    if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json(row, { headers: { 'Cache-Control': 'no-store' } });
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'No database is configured.' }, { status: 503 });
  }
  const ownerId = ownerOf(request);
  if (!ownerId) return NextResponse.json({ error: 'No device id.' }, { status: 400 });

  const { id } = await params;
  return withDatabase(async () => {
    const result = await (await sessions()).deleteOne({ ownerId, id });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
