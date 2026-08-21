/**
 * Anything the router cannot match bounces back to the app root.
 *
 * Without this an unmatched path renders Next's default 404, which has none of
 * the app's chrome and no way back into it — from a standalone PWA window,
 * with no address bar, that is a dead end.
 *
 * `/` re-runs the onboarding check, so this lands wherever a cold start would.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function NotFound() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return null;
}
