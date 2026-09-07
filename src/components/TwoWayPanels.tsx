/**
 * Two-way panels — one column per translation direction, newest at the top.
 *
 * Used when `translationType === 'two_way'`: two 50/50 columns, each showing
 * turns spoken in one language translated into the other. Each header has
 * tappable language buttons so the user can change A/B from the panel itself.
 *
 * In portrait the whole container rotates 90° so the panels are always
 * side-by-side in landscape orientation. Individual panels rotate in opposite
 * directions when the user taps Rotate, so two people across a table can each
 * read their own panel right-side-up.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

import { useWindowSize } from '@/hooks/useWindowSize';

import { cx } from './primitives';
import styles from './TwoWayPanels.module.css';

export type TwoWayLine = {
  id: string;
  text: string;
  state: 'live' | 'final' | 'old';
};

export type TwoWayPanelData = {
  sourceLabel: string;
  targetLabel: string;
  onPickSource?: () => void;
  onPickTarget?: () => void;
  onSwap?: () => void;
  lines: TwoWayLine[];
};

export function TwoWayPanels({
  panels,
  fontSize,
  rotation = 0,
  onRotate,
  onStop,
  onFontUp,
  onFontDown,
  onSwapPanels,
}: {
  panels: [TwoWayPanelData, TwoWayPanelData];
  fontSize: number;
  /** 0-3, incremented each press. Panel 0 rotates +N×90°, panel 1 rotates −N×90°. */
  rotation?: number;
  onRotate?: () => void;
  onStop?: () => void;
  onFontUp?: () => void;
  onFontDown?: () => void;
  onSwapPanels?: () => void;
}) {
  const { width, height, landscape } = useWindowSize();

  // Measure one slot so we know the dimensions to swap on 90°/270° rotations.
  const slotRef = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setSlot({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // In portrait, rotate the entire container 90° so the panels read
  // left-to-right in landscape orientation even while the device is upright.
  const containerStyle = !landscape && width > 0
    ? {
        width: height,
        height: width,
        transform: 'rotate(90deg)',
        transformOrigin: 'top left' as const,
        position: 'relative' as const,
        top: 0,
        left: width,
      }
    : undefined;

  const contentStyle = (index: number): React.CSSProperties => {
    const deg = index === 0 ? rotation * -90 : rotation * 90;
    const ortho = rotation % 2 !== 0;
    return {
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: ortho ? slot.h : slot.w,
      height: ortho ? slot.w : slot.h,
      transform: `translate(-50%, -50%) rotate(${deg}deg)`,
      display: 'flex',
      flexDirection: 'column',
    };
  };

  return (
    <div className={styles.panels} style={containerStyle}>
      {panels.map((panel, index) => (
        <div
          key={index}
          ref={index === 0 ? slotRef : undefined}
          className={cx(styles.slot, index > 0 && styles.slotDivider)}>
          <div style={contentStyle(index)}>
            <div className={styles.head}>
              {panel.onPickSource ? (
                <button
                  type="button"
                  className={styles.langBtn}
                  onClick={panel.onPickSource}>
                  {panel.sourceLabel}
                </button>
              ) : (
                <span className={styles.langLabel}>{panel.sourceLabel}</span>
              )}
              {panel.onSwap ? (
                <button
                  type="button"
                  className={styles.swapBtn}
                  onClick={panel.onSwap}
                  aria-label="Swap direction">
                  ⇄
                </button>
              ) : (
                <span className={styles.arrow}>→</span>
              )}
              {panel.onPickTarget ? (
                <button
                  type="button"
                  className={styles.langBtn}
                  onClick={panel.onPickTarget}>
                  {panel.targetLabel}
                </button>
              ) : (
                <span className={styles.langLabel}>{panel.targetLabel}</span>
              )}
            </div>

            <div className={cx(styles.lines, 'noscrollbar')}>
              {panel.lines.map((line) => (
                <span
                  key={line.id}
                  className={cx(
                    styles.line,
                    line.state === 'live' && styles.lineLive,
                    line.state === 'old' && styles.lineOld
                  )}
                  style={{ fontSize, lineHeight: `${fontSize * 1.5}px` }}>
                  {line.text}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}

      {(onRotate || onStop) && (
        <div className={styles.controls}>
          {onStop && (
            <button
              type="button"
              className={cx(styles.controlBtn, styles.stopBtn)}
              onClick={onStop}
              aria-label="Stop">
              ■
            </button>
          )}
          {onRotate && (
            <button
              type="button"
              className={styles.controlBtn}
              onClick={onRotate}
              aria-label="Rotate panels">
              ↻
            </button>
          )}
          {onFontUp && (
            <button
              type="button"
              className={styles.controlBtn}
              onClick={onFontUp}
              aria-label="Increase text size">
              A⁺
            </button>
          )}
          {onFontDown && (
            <button
              type="button"
              className={styles.controlBtn}
              onClick={onFontDown}
              aria-label="Decrease text size">
              A⁻
            </button>
          )}
          {onSwapPanels && (
            <button
              type="button"
              className={styles.controlBtn}
              onClick={onSwapPanels}
              aria-label="Swap panels">
              ⇄
            </button>
          )}
        </div>
      )}
    </div>
  );
}
