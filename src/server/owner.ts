/**
 * Who a request belongs to.
 *
 * The app has no accounts, so "who" is an anonymous id the browser minted and
 * keeps in localStorage. It arrives as a header; a cookie mirror is written so
 * a request that loses the header still resolves to the same rows.
 */
import 'server-only';

import type { NextRequest } from 'next/server';

export const OWNER_COOKIE = 'mt_device';

/** A hostile client can send anything; keep it to something index-safe. */
const VALID = /^[A-Za-z0-9._-]{8,128}$/;

export function ownerOf(request: NextRequest): string | null {
  const header = request.headers.get('x-device-id');
  if (header && VALID.test(header)) return header;
  const cookie = request.cookies.get(OWNER_COOKIE)?.value;
  if (cookie && VALID.test(cookie)) return cookie;
  return null;
}
