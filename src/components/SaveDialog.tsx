/**
 * End-of-session dialog.
 *
 * Stopping never discards silently and never saves silently — one dialog asks.
 * The fine print does two jobs: it explains what the summary is, and it
 * discloses exactly where the transcript goes before anything is sent.
 *
 * Unlike every other overlay in the app this one has no scrim tap and no
 * Escape: there is no neutral way out, because there is no neutral outcome.
 */
'use client';

import { useState } from 'react';

import { Portal } from './overlay';
import { Field } from './primitives';
import styles from './SaveDialog.module.css';

export function SaveDialog({
  visible,
  subtitle,
  summaryEnabled,
  onDiscard,
  onSave,
}: {
  visible: boolean;
  /** "42 minutes · 118 turns · 3 speakers · JA → EN" */
  subtitle: string;
  /** false where no summary key is configured — don't promise one then */
  summaryEnabled: boolean;
  onDiscard: () => void;
  /** `title` is empty when the user didn't name it — the caller falls back to
   *  the first translated sentence. */
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  if (!visible) return null;

  return (
    <Portal>
      <div className={styles.scrim} />
      <div className={styles.centerWrap}>
        <div role="dialog" aria-modal className={styles.dialog}>
          <h2 className={styles.title}>Save this conversation?</h2>
          <p className={styles.sub}>{subtitle}</p>
          <p className={styles.fine}>
            {summaryEnabled ? (
              <>
                Saving also creates an <span className={styles.fineStrong}>AI summary</span> — key
                points, decisions, and action items distilled from the whole conversation. The
                transcript is sent once to the AI provider and the result is stored with the
                session.
              </>
            ) : (
              <>
                The transcript is saved with your other sessions. This build has no{' '}
                <span className={styles.fineStrong}>AI summary</span> available, so nothing is sent
                to a provider.
              </>
            )}
          </p>

          <div className={styles.nameField}>
            <Field
              value={title}
              onChangeText={setTitle}
              placeholder="Name it (optional) — e.g. Q3 sales review"
              trailing={<span className={styles.pencil}>✎</span>}
              onSubmit={() => onSave(title.trim())}
            />
          </div>

          <div className={styles.btns}>
            <button type="button" onClick={onDiscard} className={`${styles.btn} ${styles.discard}`}>
              Delete
            </button>
            <button
              type="button"
              onClick={() => onSave(title.trim())}
              className={`${styles.btn} ${styles.keep}`}>
              Save
            </button>
          </div>

          <p className={styles.footnote}>Delete is permanent — nothing is kept.</p>
        </div>
      </div>
    </Portal>
  );
}
