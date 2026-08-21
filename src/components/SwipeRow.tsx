/**
 * Swipe left to reveal one destructive action.
 *
 * The mobile version ran on Reanimated worklets and `Gesture.Pan`; this one
 * runs on pointer events and a hand-integrated spring. The constants are the
 * same, and so are the three constraints that shaped it:
 *
 *  - The row lives inside a scroller, so the drag must *lose* to a vertical
 *    scroll. `touch-action: pan-y` hands vertical movement straight to the
 *    browser, and the axis check below refuses to activate until the pointer
 *    has clearly committed sideways — the same job `activeOffsetX([-14, 14])`
 *    and `failOffsetY([-10, 10])` did.
 *  - Only one row may be open at a time, so `open` belongs to the list, not to
 *    this component: swiping row B closes row A without either row knowing
 *    about the other.
 *  - The panel must be unreachable while closed, for pointer and screen reader
 *    alike. Keyboard and screen-reader users delete through the row's own
 *    long-press menu instead.
 *
 * The spring is integrated rather than approximated with a bezier because the
 * gesture can be caught mid-flight: grabbing a row while it springs has to pick
 * up from wherever it currently is, which a CSS transition cannot report.
 */
'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

import { color } from '@/theme/tokens';

import { TrashIcon } from './icons';
import styles from './SwipeRow.module.css';

/** Panel width. Wide enough for a 19px glyph over a label at 48pt touch height. */
const ACTION_W = 88;
/** How far past the panel the row may be dragged, so the stop feels elastic. */
const OVERSHOOT = 28;
/** Past this, releasing opens rather than snaps back. */
const OPEN_AT = ACTION_W * 0.5;
/** A flick opens regardless of distance. px/s, as gesture-handler reported it. */
const FLICK = 600;

/** Committed sideways / committed vertically, in px of travel. */
const AXIS_LOCK_X = 14;
const AXIS_LOCK_Y = 10;

// damping 20, stiffness 220, mass 0.6 — the mobile spring, in the same units.
const STIFFNESS = 220;
const DAMPING = 20;
const MASS = 0.6;
/** Below both of these, the spring has arrived. */
const REST_DISTANCE = 0.5;
const REST_VELOCITY = 0.5;

/** Left of the origin, and never further than the panel plus its overshoot. */
function clampX(x: number) {
  return Math.min(0, Math.max(-(ACTION_W + OVERSHOOT), x));
}

export function SwipeRow({
  open,
  onOpenChange,
  onAction,
  actionLabel,
  children,
}: {
  open: boolean;
  /** Fired when the gesture settles — the list decides which row stays open. */
  onOpenChange: (open: boolean) => void;
  onAction: () => void;
  /** Screen-reader label for the revealed button, e.g. `Delete "Q3 review"`. */
  actionLabel: string;
  children: ReactNode;
}) {
  const [x, setX] = useState(open ? -ACTION_W : 0);

  const frame = useRef<number | null>(null);
  const velocity = useRef(0);
  const position = useRef(x);
  const dragging = useRef(false);

  const start = useRef({ x: 0, y: 0, anchor: 0 });
  const decided = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const lastMove = useRef({ x: 0, t: 0 });

  const stopSpring = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const springTo = useCallback(
    (target: number) => {
      stopSpring();
      let previous = performance.now();

      const step = (now: number) => {
        // Clamped: a backgrounded tab resumes with a huge dt, which would fling
        // the row across the screen in one frame.
        const dt = Math.min(0.032, (now - previous) / 1000);
        previous = now;

        const displacement = position.current - target;
        const acceleration = (-STIFFNESS * displacement - DAMPING * velocity.current) / MASS;
        velocity.current += acceleration * dt;
        position.current += velocity.current * dt;

        if (
          Math.abs(position.current - target) < REST_DISTANCE &&
          Math.abs(velocity.current) < REST_VELOCITY
        ) {
          position.current = target;
          velocity.current = 0;
          setX(target);
          frame.current = null;
          return;
        }

        setX(position.current);
        frame.current = requestAnimationFrame(step);
      };

      frame.current = requestAnimationFrame(step);
    },
    [stopSpring]
  );

  // The list owns `open`; the row follows it. Skipped mid-drag, when the finger
  // is the authority on where the row is.
  useEffect(() => {
    if (dragging.current) return;
    springTo(open ? -ACTION_W : 0);
  }, [open, springTo]);

  useEffect(() => stopSpring, [stopSpring]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stopSpring();
    // Re-anchor wherever the row currently *is*, so grabbing it mid-spring
    // picks up from there instead of snapping to the last resting place.
    start.current = { x: event.clientX, y: event.clientY, anchor: position.current };
    decided.current = 'none';
    velocity.current = 0;
    lastMove.current = { x: event.clientX, t: performance.now() };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (decided.current === 'vertical') return;

    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;

    if (decided.current === 'none') {
      if (Math.abs(dy) > AXIS_LOCK_Y && Math.abs(dy) > Math.abs(dx)) {
        decided.current = 'vertical';
        return;
      }
      if (Math.abs(dx) < AXIS_LOCK_X) return;
      decided.current = 'horizontal';
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const now = performance.now();
    const elapsed = now - lastMove.current.t;
    if (elapsed > 0) {
      velocity.current = ((event.clientX - lastMove.current.x) / elapsed) * 1000;
      lastMove.current = { x: event.clientX, t: now };
    }

    const next = clampX(start.current.anchor + dx);
    position.current = next;
    setX(next);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (decided.current !== 'horizontal') {
      decided.current = 'none';
      return;
    }
    decided.current = 'none';
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const shouldOpen = position.current < -OPEN_AT || velocity.current < -FLICK;
    onOpenChange(shouldOpen);
    springTo(shouldOpen ? -ACTION_W : 0);
  };

  return (
    <div className={styles.wrap}>
      {/* Behind the row, revealed rather than animated in. Hidden from pointer
          and from the screen reader while closed, so an action the user never
          swiped to cannot be tapped or focused into. */}
      <div className={styles.actionLayer} aria-hidden={!open} inert={!open || undefined}>
        <button type="button" onClick={onAction} aria-label={actionLabel} className={styles.action}>
          <TrashIcon color={color.error} />
          Delete
        </button>
      </div>

      <div
        className={styles.front}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}>
        {children}
      </div>
    </div>
  );
}
