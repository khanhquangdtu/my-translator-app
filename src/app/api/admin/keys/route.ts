/**
 * Reading and replacing provider keys.
 *
 * GET answers with masked tails and where each key came from; it never returns
 * a usable credential, so a leaked admin session cannot be turned into a
 * leaked key by reading this endpoint alone.
 *
 * PUT verifies the key against the provider before storing it. Storing first
 * and finding out later means the next person to press Start discovers the
 * typo, which is exactly the wrong place for that to surface.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { type ProviderId, PROVIDERS, providerSpec } from '@/lib/providers/registry';
import { isAdmin } from '@/server/adminAuth';
import { hasAdminSecret } from '@/server/crypto';
import { isMongoConfigured } from '@/server/mongo';
import { clearProviderKey, providerStatus, setProviderKey } from '@/server/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();

  const providers = await Promise.all(PROVIDERS.map((p) => providerStatus(p.id)));
  return NextResponse.json(
    {
      providers,
      // The page disables editing rather than letting a save fail: without a
      // database there is nowhere to put a key, and without a secret there is
      // nothing to encrypt it under.
      writable: isMongoConfigured() && hasAdminSecret(),
      reason: !isMongoConfigured()
        ? 'No MONGODB_URI, so there is nowhere to store a key.'
        : !hasAdminSecret()
          ? 'No ADMIN_SECRET, so a key could not be encrypted.'
          : null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * Confirm a key works before it becomes the live one.
 *
 * Each provider gets its cheapest authenticated call: for Soniox the same
 * temporary-key mint the app already performs on every session start, and for
 * OpenAI a plain model list. Both cost nothing and both fail loudly on a bad
 * credential.
 */
async function verifyKey(id: ProviderId, key: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    if (id === 'soniox') {
      const response = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60 }),
        signal: controller.signal,
      });
      if (response.ok) return null;
      return response.status === 401
        ? 'Soniox rejected this key.'
        : `Soniox returned ${response.status}.`;
    }

    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (response.ok) return null;
    return response.status === 401
      ? 'OpenAI rejected this key.'
      : `OpenAI returned ${response.status}.`;
  } catch (err) {
    if (controller.signal.aborted) return 'The provider timed out.';
    return `Could not reach the provider: ${(err as Error)?.message ?? err}`;
  } finally {
    clearTimeout(timer);
  }
}

export async function PUT(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();

  if (!isMongoConfigured() || !hasAdminSecret()) {
    return NextResponse.json({ error: 'Key storage is not available.' }, { status: 503 });
  }

  let id = '';
  let key = '';
  try {
    const body = (await request.json()) as { provider?: unknown; key?: unknown };
    id = typeof body.provider === 'string' ? body.provider : '';
    key = typeof body.key === 'string' ? body.key.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const spec = providerSpec(id);
  if (!spec) return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  if (!spec.keyPattern.test(key)) {
    return NextResponse.json({ error: `That does not look right. ${spec.keyHint}` }, { status: 400 });
  }

  const failure = await verifyKey(spec.id, key);
  if (failure) return NextResponse.json({ error: failure }, { status: 400 });

  await setProviderKey(spec.id, key);
  return NextResponse.json({ provider: await providerStatus(spec.id) });
}

/**
 * Forget the stored key so the environment variable takes over again.
 *
 * The escape hatch when a saved key is wrong but `.env.local` is still right.
 */
export async function DELETE(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();

  const id = new URL(request.url).searchParams.get('provider') ?? '';
  const spec = providerSpec(id);
  if (!spec) return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });

  await clearProviderKey(spec.id);
  return NextResponse.json({ provider: await providerStatus(spec.id) });
}
