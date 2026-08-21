/**
 * Track slider: `[min] [4px track with fill, a 16px thumb, and the current
 * value riding above it] [max]`.
 *
 * The ends are fixed signposts — they always read the range, so you can see how
 * far a drag has to go without doing arithmetic on a moving number. The current
 * value travels with the thumb instead, which is where the eye already is
 * mid-drag.
 *
 * Pointer events with a capture rather than an `<input type="range">`: the
 * native control cannot be styled into this shape across browsers, and the
 * mobile version this is ported from used the raw responder callbacks for the
 * same reason. Keyboard support is added back explicitly, since that is the one
 * thing the native input would have given us.
 */
'use client';

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

import styles from './Slider.module.css';

const THUMB = 16;
/** Fixed width, so the readout never re-measures as digits are added or lost. */
const VALUE_W = 52;

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  minLabel,
  maxLabel,
  valueLabel,
  accessibilityLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  /** fixed signpost at the left end — the bottom of the range */
  minLabel: string;
  /** fixed signpost at the right end — the top of the range */
  maxLabel: string;
  /** travels with the thumb; carries the unit */
  valueLabel: string;
  accessibilityLabel: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const handle = (event: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const raw = min + ratio * (max - min);
    onChange(Math.round(raw / step) * step);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Capture so a drag that leaves the 32px band still tracks — the finger
    // wanders vertically far more than the eye expects.
    event.currentTarget.setPointerCapture(event.pointerId);
    handle(event);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    handle(event);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? step
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -step
          : event.key === 'Home'
            ? min - value
            : event.key === 'End'
              ? max - value
              : 0;
    if (!delta) return;
    event.preventDefault();
    onChange(Math.max(min, Math.min(max, value + delta)));
  };

  const ratio = max === min ? 0 : (value - min) / (max - min);
  const percent = `${ratio * 100}%`;

  return (
    <div className={styles.wrap}>
      <span className={styles.edgeLabel}>{minLabel}</span>

      {/* The readout is a sibling of the hit area, not a child of it: they
          share a coordinate space (both span this column), while the pointer
          area stays exactly the 32px band around the track and does not grow to
          swallow the list's vertical scroll. */}
      <div className={styles.column}>
        <span
          className={styles.value}
          style={{
            // Centred on the thumb, but never past either end of the track: at
            // the extremes half the readout would hang off into the signposts.
            left: `clamp(0px, calc(${percent} - ${VALUE_W / 2}px), calc(100% - ${VALUE_W}px))`,
          }}>
          {valueLabel}
        </span>
        <div
          ref={trackRef}
          className={styles.trackHit}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
          role="slider"
          tabIndex={0}
          aria-label={accessibilityLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={valueLabel}>
          <div className={styles.track}>
            <div className={styles.fill} style={{ width: percent }} />
            <div className={styles.thumb} style={{ left: `calc(${percent} - ${THUMB / 2}px)` }} />
          </div>
        </div>
      </div>

      <span className={styles.edgeLabel}>{maxLabel}</span>
    </div>
  );
}
