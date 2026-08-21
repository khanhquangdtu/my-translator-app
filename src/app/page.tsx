/**
 * Live is the root of the app; onboarding only stands in front of it once.
 *
 * A redirect rather than a rewrite, so the URL bar and the back stack both
 * reflect where the user actually is — and so the PWA's `start_url: "/"`
 * re-runs the check on every cold launch, as the mobile app did.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useSettings } from '@/state/settingsStore';

export default function Index() {
  const router = useRouter();
  const onboarded = useSettings((s) => s.prefs.onboarded);

  useEffect(() => {
    router.replace(onboarded ? '/live' : '/onboarding/1');
  }, [onboarded, router]);

  // Page-coloured and empty: this is on screen for one frame.
  return null;
}
