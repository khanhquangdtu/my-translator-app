/**
 * The client boundary, and the hydration gate behind it.
 *
 * The mobile app's `_layout.tsx` held the splash screen until fonts and saved
 * settings had both loaded, then rendered. The same gate is needed here for a
 * sharper reason: prefs live in localStorage, which does not exist on the
 * server, so a first paint before they load would show defaults and then snap —
 * `onboarded: false` would flash the onboarding screen at every returning user.
 *
 * Rendering nothing until the store is ready is also what makes this a
 * client-rendered app: no screen is ever produced on the server.
 */
'use client';

import { useEffect, useState } from 'react';

import { useCapabilities } from '@/lib/config/capabilities';
import { startSync } from '@/lib/sessions/store';
import { useSettings } from '@/state/settingsStore';

export function Providers({ children }: { children: React.ReactNode }) {
  const loaded = useSettings((s) => s.loaded);
  const load = useSettings((s) => s.load);
  const loadCapabilities = useCapabilities((s) => s.load);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    void load();
    void loadCapabilities();
    return startSync();
  }, [load, loadCapabilities]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    // Registered after load so it never competes with the first paint for
    // bandwidth on a cold, slow connection.
    const register = () => void navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  // A bare page-coloured shell, matching the splash: anything richer would
  // flash for one frame and be gone.
  if (!mounted || !loaded) return <div id="root-shell" />;

  return <div id="root-shell">{children}</div>;
}
