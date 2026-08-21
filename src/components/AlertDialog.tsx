/**
 * One message, one button — the shape of `Alert.alert(title, message)`.
 *
 * Live uses it for the three ways a session can fail to start. `ConfirmDialog`
 * would be wrong here: offering Cancel next to OK implies there is a choice,
 * and there isn't one.
 */
'use client';

import { motion } from '@/theme/tokens';

import styles from './dialog.module.css';
import { Portal, useEscape, usePresence } from './overlay';
import { Cta, cx } from './primitives';

export function AlertDialog({
  visible,
  title,
  message,
  confirmLabel = 'OK',
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  onClose: () => void;
}) {
  const { mounted, open } = usePresence(visible, motion.fast);
  useEscape(visible, onClose);

  if (!mounted) return null;

  return (
    <Portal>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={cx(styles.scrim, open && styles.scrimOpen)}
      />
      <div className={styles.centerWrap}>
        <div role="alertdialog" aria-modal className={cx(styles.card, open && styles.cardOpen)}>
          <h2 className={styles.title}>{title}</h2>
          {message ? <p className={styles.message}>{message}</p> : null}
          <div className={styles.actions}>
            <Cta label={confirmLabel} flex={1} onPress={onClose} />
          </div>
        </div>
      </div>
    </Portal>
  );
}
