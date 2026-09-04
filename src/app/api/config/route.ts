/**
 * What this deployment can do — two booleans, never the keys themselves.
 *
 * The mobile build answered this from constants inlined into the bundle. Here
 * the browser has to ask, because the whole point is that it cannot see them.
 */
import { NextResponse } from 'next/server';

import { hasProviderKey } from '@/server/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Async now, because a key set from the admin page lives in the database
  // rather than the environment. Without this the browser would keep believing
  // a freshly configured deployment had no keys until the next restart.
  const [soniox, openai] = await Promise.all([hasProviderKey('soniox'), hasProviderKey('openai')]);
  return NextResponse.json({ soniox, openai });
}
