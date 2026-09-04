/**
 * What each provider has cost over a window.
 *
 * One endpoint for every provider rather than one per provider: the shapes are
 * normalised in `server/usage.ts`, so the dashboard makes a single request and
 * renders whatever came back.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { isAdmin } from '@/server/adminAuth';
import { allUsage, windowStart } from '@/server/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Soniox is a network hop away and the default 15 s can be tight on a cold call. */
export const maxDuration = 30;

const ALLOWED_WINDOWS = [7, 30, 90];
const DEFAULT_WINDOW = 30;

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const requested = Number(new URL(request.url).searchParams.get('days'));
  // Clamped to a fixed set rather than accepting any integer: an arbitrary
  // window would let a signed-in session ask Soniox for years of daily buckets.
  const days = ALLOWED_WINDOWS.includes(requested) ? requested : DEFAULT_WINDOW;

  const providers = await allUsage(days);

  return NextResponse.json(
    { days, since: windowStart(days).toISOString().slice(0, 10), providers },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
