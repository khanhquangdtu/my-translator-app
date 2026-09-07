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
import { color } from '@/theme/tokens';

import { ArrowRightIcon } from './icons';
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
  //
  // `flex: '0 0 auto'` is load-bearing, not tidiness. `.panels` carries
  // `flex: 1`, and in the column that `Screen` lays out that makes height the
  // flex main size — so flex-grow won, the container was stretched from the
  // 390 asked for here to the full 844 of the viewport, and after the rotation
  // that surplus hung off the *left* edge of the screen. The controls sat in
  // the middle of it: A⁺, A⁻ and Swap were rendered at negative x, entirely
  // outside the window. Opting out of flex sizing is what makes the width and
  // height on these two lines the sizes the element actually gets.
  const rotated = !landscape && width > 0;
  const containerStyle = rotated
    ? {
        flex: '0 0 auto',
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
    <div
      className={cx(styles.panels, rotated ? styles.panelsRotated : styles.panelsUpright)}
      style={containerStyle}>
      {panels.map((panel, index) => (
        <div
          key={index}
          ref={index === 0 ? slotRef : undefined}
          className={cx(styles.slot, index > 0 && styles.slotDivider)}>
          <div style={contentStyle(index)}>
            {/* Upright, this sits in the control bar instead — see below. */}
            {rotated && <PanelHead panel={panel} />}

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

      {/*
        Upright, the bar carries the two panel headers as well as the buttons,
        so the whole of the chrome is one row deep instead of two — on a phone
        held sideways that band is a real fraction of the reading area. The
        headers are laid out as flex cells rather than centred over their own
        panel, which is what keeps them off the buttons on a narrow screen:
        centring collided below about 764 px of width.

        Rotated, they stay inside their panel, where turning one panel turns
        its language pills with it. That is the table-mode case, and a header
        that stayed upright while its own text turned over would belong to
        neither reader.
      */}
      {(onRotate || onStop || !rotated) && (
        <div
          className={cx(
            styles.controls,
            rotated ? styles.controlsRotated : styles.controlsUpright
          )}>
          {!rotated && <PanelHead panel={panels[0]} className={styles.headInBar} />}
          <div className={styles.controlButtons}>
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
          {!rotated && <PanelHead panel={panels[1]} className={styles.headInBar} />}
        </div>
      )}
    </div>
  );
}

/**
 * One panel's `EN → VI` header.
 *
 * The arrow points one way because the panel only goes one way: it shows what
 * was spoken in EN, rendered in VI, and nothing else. A `⇄` here said the
 * opposite — that this panel carried both directions — which is precisely what
 * distinguishes it from the panel beside it, and it read the same in both.
 * Tapping still swaps; the labels either side are what change, and a one-way
 * arrow is what makes that change legible.
 *
 * `⇄` survives on the bar's Swap button, which really does exchange the two
 * panels, so the two glyphs now mean two different things instead of one thing
 * twice.
 *
 * Extracted because it is rendered in two different places depending on the
 * orientation — inside the panel when the container is rotated, in the control
 * bar when it is not — and the two must stay the same control.
 */
function PanelHead({ panel, className }: { panel: TwoWayPanelData; className?: string }) {
  return (
    <div className={cx(styles.head, className)}>
      {panel.onPickSource ? (
        <button type="button" className={styles.langBtn} onClick={panel.onPickSource}>
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
          aria-label={`Translating ${panel.sourceLabel} to ${panel.targetLabel} — tap to reverse`}>
          <ArrowRightIcon color={color.accent} />
        </button>
      ) : (
        <span className={styles.arrow}>
          <ArrowRightIcon size={12} color={color.textMuted} />
        </span>
      )}
      {panel.onPickTarget ? (
        <button type="button" className={styles.langBtn} onClick={panel.onPickTarget}>
          {panel.targetLabel}
        </button>
      ) : (
        <span className={styles.langLabel}>{panel.targetLabel}</span>
      )}
    </div>
  );
}
