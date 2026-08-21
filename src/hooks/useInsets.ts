/**
 * `useSafeAreaInsets()`, in CSS terms.
 *
 * Most of the app can use the `--inset-*` variables directly. This hook exists
 * for the handful of places that do arithmetic on them in JS — the action bar's
 * `paddingBottom: 14 + insets.bottom` was written that way on mobile and the
 * ports read better keeping it.
 *
 * The values are read from the computed style rather than from `env()` directly
 * because `env()` is only usable inside CSS; `tokens.css` resolves it onto
 * `:root` and this reads back what it resolved to.
 */
'use client';

import { useEffect, useState } from 'react';

export type Insets = { top: number; bottom: number; left: number; right: number };

const NONE: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

function read(): Insets {
  const style = getComputedStyle(document.documentElement);
  const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
  return {
    top: px('--inset-top'),
    bottom: px('--inset-bottom'),
    left: px('--inset-left'),
    right: px('--inset-right'),
  };
}

export function useInsets(): Insets {
  // Starts at zero and fills in after mount: server and first client render
  // must agree, and the real values only exist in the browser.
  const [insets, setInsets] = useState<Insets>(NONE);

  useEffect(() => {
    const update = () => setInsets(read());
    update();
    // Rotating a phone changes which edge the notch is on.
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return insets;
}
