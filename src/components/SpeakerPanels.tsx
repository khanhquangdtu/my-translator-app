/**
 * Speaker panels — one column per speaker, newest at the top of each.
 *
 * An opt-in second layout for the moment a conversation stops being a monologue
 * and starts being a back-and-forth: with a column each, you stop scanning for
 * who said what. Columns need width, so choosing this mode asks for landscape
 * until it is switched back.
 *
 * Above three active speakers the columns get too narrow to read, so the caller
 * falls back to the stream rather than shipping an unreadable grid.
 */
'use client';

import { labelFor, railFor } from '@/theme/tokens';

import { cx } from './primitives';
import styles from './SpeakerPanels.module.css';

/** Beyond this the columns are narrower than a comfortable line. */
export const MAX_PANELS = 3;

export type PanelLine = {
  id: string;
  text: string;
  state: 'live' | 'final' | 'old';
};

export type Panel = {
  speakerId: string;
  name: string;
  speakerIndex: number;
  turnCount: number;
  /** newest first */
  lines: PanelLine[];
};

export function SpeakerPanels({ panels, fontSize }: { panels: Panel[]; fontSize: number }) {
  return (
    <div className={styles.panels}>
      {panels.map((panel, index) => (
        <div
          key={panel.speakerId}
          className={cx(styles.panel, index > 0 && styles.panelDivider)}>
          <div className={styles.head}>
            <span
              className={styles.headDot}
              style={{ background: railFor(panel.speakerIndex) }}
            />
            <span className={styles.headName} style={{ color: labelFor(panel.speakerIndex) }}>
              {panel.name.toUpperCase()}
            </span>
            <span className={styles.headCount}>{panel.turnCount} turns</span>
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
      ))}
    </div>
  );
}
