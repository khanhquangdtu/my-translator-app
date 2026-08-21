/**
 * What this deployment can do — two booleans, never the keys themselves.
 *
 * The mobile build answered this from constants inlined into the bundle. Here
 * the browser has to ask, because the whole point is that it cannot see them.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    soniox: !!process.env.SONIOX_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
  });
}
