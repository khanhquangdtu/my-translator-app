/**
 * A run of speech from one speaker — the single most important component.
 *
 * A "turn" as the engine reports it is one recognised utterance, and a speaker
 * talking without interruption produces several in a row. Drawing each as its
 * own row repeated the name chip down the screen and chopped one continuous
 * thought into stripes, so this takes a *list* of lines and draws them as one
 * block under a single chip. Live groups a run; the Library archive passes one
 * line at a time, because there each segment carries its own timestamp.
 *
 * The speaker name is a small chip at the head of the block rather than a label
 * on its own row: a separate label row costs more vertical space than it earns,
 * and the 2px rail already carries the identity. The chip's grey pill does the
 * separating that a leading ● used to, without spending a glyph on it.
 *
 * Chip and text sit in a flex row. On mobile the alternative — an inline view
 * inside the text — anchored to the baseline and rode visibly above the line it
 * labelled; the row centres them geometrically instead: the chip's slot is
 * exactly one line tall and the row is top-aligned, so chip and first line share
 * an axis at every size. The cost, on both platforms, is that wrapped lines
 * indent under the text column rather than returning to the rail.
 *
 * `showSource` folds a line's original out beneath it at 0.7× size and a dimmer
 * tint, so it reads as annotation rather than as a second caption. The Library
 * transcript leaves it on for every line; Live leaves it off and lets a tap on
 * one caption reveal just that one, which keeps the default reading uncluttered
 * without hiding the evidence for a line the reader doubts.
 *
 * Three lifecycle states carry the reading: `live` (still being recognised,
 * dimmed), final (full brightness), and `old` (scrolled back, 62%).
 */
'use client';

import { color, labelFor, railFor } from '@/theme/tokens';

import { cx } from './primitives';
import styles from './Turn.module.css';

export type TurnState = 'live' | 'final' | 'old';

export type TurnLine = {
  /** stable identity for keying — the turn id, or `provisional` */
  key: string;
  src: string;
  dst: string;
  state: TurnState;
  /** fold this line's original out beneath it */
  showSource: boolean;
  /** omit to leave the line inert — the archive, where the source is always on */
  onPress?: () => void;
};

export function TurnView({
  speakerName,
  speakerIndex,
  lines,
  fontSize,
  timestamp,
}: {
  speakerName: string | null;
  speakerIndex: number;
  /** newest first, matching the stream */
  lines: TurnLine[];
  /** translation size; the source line derives from it */
  fontSize: number;
  /** archive only — appended to the speaker chip */
  timestamp?: string;
}) {
  const lineHeight = fontSize * 1.55;
  // The chip labels the whole block, so it takes its dimming from the line it
  // sits beside rather than from the oldest one in the run.
  const headState = lines[0]?.state ?? 'final';

  return (
    <div className={styles.turn} style={{ borderLeftColor: railFor(speakerIndex) }}>
      <div className={styles.headline}>
        {speakerName ? (
          <span className={styles.speakerSlot} style={{ height: lineHeight }}>
            <span className={cx(styles.speakerPill, headState === 'old' && styles.speakerPillOld)}>
              <span className={styles.speaker} style={{ color: labelFor(speakerIndex) }}>
                {`${speakerName}${timestamp ? ` · ${timestamp}` : ''}`}
              </span>
            </span>
          </span>
        ) : null}

        <div className={styles.lines}>
          {lines.map((line) => {
            // A line that never received a translation still deserves to be
            // readable, so its source becomes the primary text rather than the
            // annotation.
            const primary = line.dst || line.src;
            const secondary = line.dst ? line.src : '';

            const dstColor =
              line.state === 'live'
                ? color.textProvisional
                : line.state === 'old'
                  ? color.textOld
                  : color.textPrimary;
            const srcColor =
              line.state === 'live'
                ? color.textLiveSrc
                : line.state === 'old'
                  ? color.textOldSrc
                  : color.textProvisional;

            const body = (
              <>
                <span
                  className={styles.dst}
                  style={{ fontSize, lineHeight: `${lineHeight}px`, color: dstColor }}>
                  {primary}
                </span>
                {line.showSource && secondary ? (
                  <span
                    className={styles.src}
                    style={{
                      fontSize: fontSize * 0.7,
                      lineHeight: `${fontSize * 0.7 * 1.45}px`,
                      color: srcColor,
                    }}>
                    {secondary}
                  </span>
                ) : null}
              </>
            );

            return line.onPress ? (
              <button
                key={line.key}
                type="button"
                onClick={line.onPress}
                aria-label={line.showSource ? 'Hide the original' : 'Show the original'}
                aria-expanded={line.showSource}
                className={cx(styles.line, styles.linePressable)}>
                {body}
              </button>
            ) : (
              <div key={line.key} className={styles.line}>
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** "NEWEST" label with a hairline rule filling the rest of the width. */
export function NewestDivider() {
  return (
    <div className={styles.newest}>
      <span className={styles.newestLabel}>NEWEST</span>
      <span className={styles.newestRule} />
    </div>
  );
}
