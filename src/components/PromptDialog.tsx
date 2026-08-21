/**
 * Single-field prompt.
 *
 * On mobile this existed because `Alert.prompt` is iOS-only. On web the
 * equivalent trap is `window.prompt`, which is blocking, unstyleable, and
 * suppressed outright in some contexts — so the same component earns its keep
 * for the same reason.
 */
'use client';

import { useState } from 'react';

import { motion } from '@/theme/tokens';

import styles from './dialog.module.css';
import { Portal, useEscape, usePresence } from './overlay';
import { Cta, cx, Field } from './primitives';

export function PromptDialog({
  visible,
  title,
  message,
  initialValue = '',
  placeholder,
  confirmLabel = 'Save',
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  // Callers pass a `key` that changes per subject, so the dialog remounts with
  // the right initial value instead of syncing it back in an effect.
  const [value, setValue] = useState(initialValue);
  const { mounted, open } = usePresence(visible, motion.fast);
  useEscape(visible, onCancel);

  if (!mounted) return null;

  const submit = () => {
    if (value.trim()) onConfirm(value.trim());
  };

  return (
    <Portal>
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className={cx(styles.scrim, open && styles.scrimOpen)}
      />
      <div className={styles.centerWrap}>
        <div role="dialog" aria-modal className={cx(styles.card, open && styles.cardOpen)}>
          <h2 className={styles.title}>{title}</h2>
          {message ? <p className={styles.message}>{message}</p> : null}
          <Field
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            autoFocus
            onSubmit={submit}
          />
          <div className={styles.actions}>
            <Cta label="Cancel" variant="ghost" flex={1} onPress={onCancel} />
            <Cta label={confirmLabel} flex={1} disabled={!value.trim()} onPress={submit} />
          </div>
        </div>
      </div>
    </Portal>
  );
}
