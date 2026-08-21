/**
 * The two waveform widgets from the mockup: a live 7-bar level meter and the
 * static idle wave that stands in for it before a session starts.
 *
 * Ported unchanged, timers and all. Driving these off `useLive.subscribe` into
 * a ref, and sampling that ref on an interval, is not an optimisation detail —
 * the level updates roughly 15 times a second from the audio callback, and
 * rendering on every one of those would put the transcript's render loop behind
 * the microphone.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

import { QUIET_THRESHOLD } from '@/lib/audio/level';
import { useLive } from '@/state/liveStore';
import { color } from '@/theme/tokens';

import styles from './meter.module.css';
import { cx } from './primitives';

const BAR_COUNT = 7;
const METER_HEIGHT = 22;
const MIN_BAR = 3;

/** Sampling cadence for the meter — fast enough to feel live, slow enough not
 *  to re-render on every audio block. */
const SAMPLE_MS = 90;

export function LevelMeter({ height = METER_HEIGHT }: { height?: number }) {
  const [bars, setBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));
  const latest = useRef(0);

  useEffect(() => {
    const unsubscribe = useLive.subscribe((state) => {
      latest.current = state.level;
    });
    const timer = setInterval(() => {
      setBars((prev) => [...prev.slice(1), latest.current]);
    }, SAMPLE_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  const peak = Math.max(...bars);
  const quiet = peak < QUIET_THRESHOLD;

  return (
    <div className={styles.meter} style={{ height }} aria-label="Microphone level" role="img">
      {bars.map((level, i) => (
        <span
          key={i}
          className={styles.bar}
          style={{
            height: MIN_BAR + level * (height - MIN_BAR),
            background: quiet ? color.textMuted : color.accent,
          }}
        />
      ))}
    </div>
  );
}

/** Frozen waveform for the idle screen — 25% opacity, centre-aligned. */
const IDLE_HEIGHTS = [9, 20, 32, 15, 26, 11, 19];

const WAVE_HEIGHT = 34;
const WAVE_MIN = 5;
/** Each bar breathes at its own rate so the row never pulses as one block. */
const BAR_SPEED = [1.0, 1.45, 0.75, 1.25, 0.9, 1.6, 1.15];
const BAR_PHASE = [0, 1.1, 2.3, 0.6, 1.8, 2.9, 0.3];
const WAVE_TICK_MS = 70;

/**
 * The centre waveform.
 *
 * While idle it is a frozen shape. While listening it moves — and it moves for
 * two different reasons at once, which is the point:
 *
 *  - a slow idle "breath" so the screen never looks frozen or crashed while the
 *    room happens to be quiet, and
 *  - real amplitude from the microphone on top of it.
 *
 * Breath alone would be a lie (it would look identical whether or not the app
 * could hear anything); amplitude alone goes completely flat in a silent room
 * and reads as a hang. Together they say "I am running" and "this is what I can
 * hear" at the same time.
 */
export function IdleWave({ active }: { active?: boolean }) {
  const [heights, setHeights] = useState<number[]>(IDLE_HEIGHTS);
  const tick = useRef(0);
  const level = useRef(0);

  useEffect(() => {
    if (!active) return;

    const unsubscribe = useLive.subscribe((state) => {
      level.current = state.level;
    });

    const timer = setInterval(() => {
      tick.current += 1;
      const t = (tick.current * WAVE_TICK_MS) / 1000;
      const amplitude = level.current;
      setHeights(
        BAR_SPEED.map((speed, i) => {
          const breath = (Math.sin(t * speed * Math.PI + BAR_PHASE[i]) + 1) / 2;
          // Breath dominates when silent; voice takes over as soon as there is any.
          const mix = breath * 0.3 + amplitude * breath * 0.7 + amplitude * 0.3;
          return WAVE_MIN + Math.min(1, mix) * (WAVE_HEIGHT - WAVE_MIN);
        })
      );
    }, WAVE_TICK_MS);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [active]);

  // Derived, not reset in an effect: when inactive the frozen shape is simply
  // what gets rendered, so no state has to be written back on the way out.
  const displayed = active ? heights : IDLE_HEIGHTS;

  return (
    <div className={cx(styles.wave, active && styles.waveActive)}>
      {displayed.map((h, i) => (
        <span key={i} className={styles.bar} style={{ height: h, background: color.accent }} />
      ))}
    </div>
  );
}

/** Static "good signal" meter used during onboarding, before capture starts. */
const ONBOARDING_HEIGHTS = [7, 14, 19, 11, 16, 6, 9];

export function StaticMeter({ quiet }: { quiet?: boolean }) {
  return (
    <div className={styles.meter} style={{ height: METER_HEIGHT }}>
      {ONBOARDING_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={styles.bar}
          style={{
            height: quiet ? Math.max(MIN_BAR, h / 2.5) : h,
            background: quiet ? color.textMuted : color.accent,
          }}
        />
      ))}
    </div>
  );
}
