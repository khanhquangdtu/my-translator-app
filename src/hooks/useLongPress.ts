/**
 * `onLongPress`, which RN gave for free and the DOM does not.
 *
 * Used by the Library rows, where a long press opens the row's action menu.
 * Two details make it behave like the native one:
 *
 *  - a small movement tolerance, so the press that turns into a scroll or a
 *    swipe cancels instead of firing a menu under the user's thumb;
 *  - `contextmenu` is bound as well, so a right-click on a desktop pointer
 *    reaches the same menu — that is the platform's own long press.
 *
 * The returned handlers spread onto any element. It also reports whether a long
 * press fired, so the element's `click` can be suppressed afterwards.
 */
'use client';

import { useCallback, useRef, type PointerEvent, type MouseEvent } from 'react';

const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;

export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      cancel();
      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, HOLD_MS);
    },
    [cancel, onLongPress]
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!timer.current) return;
      const dx = Math.abs(event.clientX - origin.current.x);
      const dy = Math.abs(event.clientY - origin.current.y);
      if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) cancel();
    },
    [cancel]
  );

  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      fired.current = true;
      onLongPress();
    },
    [onLongPress]
  );

  return {
    /** True if the last gesture was a long press — check it before acting on click. */
    didLongPress: () => fired.current,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu,
    },
  };
}
