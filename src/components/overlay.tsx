/**
 * The two things RN's `<Modal>` gave us for free and the DOM does not.
 *
 * `Portal` puts an overlay outside the app's stacking context, so a sheet is
 * never clipped by a scroll container or out-ordered by a z-index further up
 * the tree.
 *
 * `usePresence` keeps a closing overlay mounted for the length of its exit
 * transition. RN unmounted the Modal on `visible=false` and animated inside it;
 * in CSS the element has to still exist to transition, so the flag is split
 * into "is it in the DOM" and "is it in its open state".
 */
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

export function usePresence(visible: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(visible);
  const [open, setOpen] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      // Mount closed, then flip open on the next frame — a transition needs two
      // committed states to interpolate between.
      const frame = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(frame);
    }
    setOpen(false);
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [visible, exitMs]);

  return { mounted, open };
}

/** Escape closes any overlay, as the Android back button did on mobile. */
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, onEscape]);
}
