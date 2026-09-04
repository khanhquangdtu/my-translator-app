/**
 * Who may touch the admin area.
 *
 * The rest of this app has no accounts on purpose — `ownerOf()` returns an
 * anonymous id the browser minted, which identifies a device and authenticates
 * nothing. That is fine for "show me my own saved sessions" and completely
 * inadequate here: this area reads and writes provider API keys, on a host with
 * a public IP. So the admin area gets real authentication, separate from and
 * unrelated to device ids.
 *
 * A single shared password rather than user accounts, because there is exactly
 * one operator and a user table would be more code guarding the same secret.
 *
 * The session is a signed cookie, not a database row: nothing needs to be
 * revoked individually, and a stateless token means an admin page that still
 * works while Mongo is down — which is precisely when someone may need to look
 * at it.
 */
import 'server-only';

import type { NextRequest } from 'next/server';

import { hasAdminSecret, safeEqual, sign, verifySignature } from './crypto';

export const ADMIN_COOKIE = 'mt_admin';

/**
 * Eight hours. Long enough to work through a deploy without re-typing the
 * password, short enough that a session left open on a borrowed machine is not
 * indefinite. There is no refresh — re-authenticating twice a day is not a
 * burden for the one person who does this.
 */
const SESSION_MS = 8 * 60 * 60 * 1000;

/** Whether the admin area is usable at all in this deployment. */
export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD?.trim() && hasAdminSecret();
}

/**
 * Why the admin area is unavailable, phrased for the operator who has to fix
 * it. Returns null when everything is present.
 */
export function adminConfigProblem(): string | null {
  const password = !!process.env.ADMIN_PASSWORD?.trim();
  const secret = hasAdminSecret();
  if (password && secret) return null;
  if (!password && !secret) return 'Set ADMIN_PASSWORD and ADMIN_SECRET, then restart.';
  if (!password) return 'Set ADMIN_PASSWORD, then restart.';
  return 'Set ADMIN_SECRET, then restart.';
}

export function checkPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected) return false;
  return safeEqual(candidate, expected);
}

/**
 * The cookie value: an expiry, and a signature over it.
 *
 * Carrying the expiry inside the signed payload rather than relying on the
 * cookie's own Max-Age matters — a client controls when it stops sending a
 * cookie, but it cannot move an expiry the server signed.
 */
export function mintSession(): { value: string; maxAge: number } {
  const expiresAt = Date.now() + SESSION_MS;
  const payload = String(expiresAt);
  return { value: `${payload}.${sign(payload)}`, maxAge: Math.floor(SESSION_MS / 1000) };
}

export function sessionValid(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return false;

  const payload = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  if (!verifySignature(payload, signature)) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

/** True when this request carries a valid admin session. */
export function isAdmin(request: NextRequest): boolean {
  if (!adminConfigured()) return false;
  return sessionValid(request.cookies.get(ADMIN_COOKIE)?.value);
}

/**
 * The cookie attributes, in one place so login and logout cannot disagree.
 *
 * `secure` is conditional because the app is developed over plain http on
 * localhost, where a Secure cookie is never sent back and login would appear to
 * succeed and then not work. In production the deployment is https-only anyway
 * — the microphone requires it.
 */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}
