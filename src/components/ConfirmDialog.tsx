/**
 * Destructive confirmation.
 *
 * The Library's delete is reached by a swipe — a gesture a thumb can trigger
 * while scrolling — so the warning has to carry weight: the app's own type, the
 * subject named back to the user, and the irreversibility stated rather than
 * implied. The confirm button is `stop`-red and second in reading order; cancel
 * is the wide, quiet default.
 */
'use client';

import { motion } from '@/theme/tokens';

import styles from './dialog.module.css';
import { Portal, useEscape, usePresence } from './overlay';
import { Cta, cx } from './primitives';

export function ConfirmDialog({
  visible,
  title,
  message,
  footnote,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message?: string;
  /** The consequence, spelled out under the buttons. */
  footnote?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { mounted, open } = usePresence(visible, motion.fast);
  useEscape(visible, onCancel);

  if (!mounted) return null;

  return (
    <Portal>
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className={cx(styles.scrim, open && styles.scrimOpen)}
      />
      <div className={styles.centerWrap}>
        <div role="alertdialog" aria-modal className={cx(styles.card, open && styles.cardOpen)}>
          <h2 className={styles.title}>{title}</h2>
          {message ? <p className={styles.message}>{message}</p> : null}
          <div className={styles.actions}>
            <Cta label={cancelLabel} variant="ghost" flex={1} onPress={onCancel} />
            <Cta label={confirmLabel} variant="stop" flex={1} onPress={onConfirm} />
          </div>
          {footnote ? <p className={styles.footnote}>{footnote}</p> : null}
        </div>
      </div>
    </Portal>
  );
}
