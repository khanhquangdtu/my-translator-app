/**
 * `useWindowDimensions()`, and the one thing every screen asks it.
 *
 * Landscape is decided by `width > height`, exactly as on mobile — not by
 * `orientation: landscape` media queries and not by a device check. A desktop
 * window is wider than it is tall, so it gets the table-mode layout, which is
 * the layout that suits a wide screen anyway.
 */
'use client';

import { useEffect, useState } from 'react';

export function useWindowSize() {
  // Zero until mounted, so the first client render matches the server's.
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return { ...size, landscape: size.width > size.height };
}
