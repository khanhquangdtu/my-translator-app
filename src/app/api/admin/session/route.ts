/**
 * Admin login, logout, and "am I still signed in".
 *
 * The password never leaves this route: what goes back is a signed cookie, and
 * every other admin endpoint checks that instead of re-reading the password.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  ADMIN_COOKIE,
  adminConfigProblem,
  adminConfigured,
  checkPassword,
  cookieOptions,
  isAdmin,
  mintSession,
} from '@/server/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Brute-force throttle, per source address.
 *
 * In-process and therefore lost on restart, which is a real limitation and an
 * acceptable one: this raises the cost of guessing a password over the network
 * from "unlimited" to "five tries a minute", and anything stronger belongs in
 * front of the app rather than inside it.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

const globalForThrottle = globalThis as unknown as {
  _adminAttempts?: Map<string, { count: number; first: number }>;
};
const attempts = (globalForThrottle._adminAttempts ??= new Map());

function clientAddress(request: NextRequest): string {
  // Behind Caddy the socket address is the proxy's, so the forwarded header is
  // the only thing that distinguishes callers. It is client-controlled and
  // therefore spoofable — which downgrades this to a speed bump, not a control.
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function throttled(address: string): boolean {
  const entry = attempts.get(address);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(address);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function noteFailure(address: string): void {
  const entry = attempts.get(address);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(address, { count: 1, first: Date.now() });
    return;
  }
  entry.count += 1;
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    configured: adminConfigured(),
    problem: adminConfigProblem(),
    signedIn: isAdmin(request),
  });
}

export async function POST(request: NextRequest) {
  if (!adminConfigured()) {
    return NextResponse.json({ error: adminConfigProblem() }, { status: 503 });
  }

  const address = clientAddress(request);
  if (throttled(address)) {
    return NextResponse.json(
      { error: 'Too many attempts. Wait a minute and try again.' },
      { status: 429 }
    );
  }

  let password = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  if (!checkPassword(password)) {
    noteFailure(address);
    // Deliberately not "wrong password" versus "no password set": both are the
    // same non-answer to someone probing.
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  attempts.delete(address);

  const session = mintSession();
  const response = NextResponse.json({ signedIn: true });
  response.cookies.set(ADMIN_COOKIE, session.value, cookieOptions(session.maxAge));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ signedIn: false });
  response.cookies.set(ADMIN_COOKIE, '', cookieOptions(0));
  return response;
}
