/**
 * Bottom sheet — where the tab bar went.
 *
 * The mockup deliberately has no bottom navigation, so this sheet carries both
 * the navigation destinations and the session actions, separated so the two
 * kinds of choice never get confused with each other.
 *
 * Ported from the mobile version, which was built on RN's Modal + Animated
 * rather than a gesture library — these sheets are short static lists with no
 * drag-to-dismiss, so a dependency would buy nothing. The same holds here: a
 * portal, a CSS transform transition, and Escape to close.
 */
'use client';

import type { ReactNode } from 'react';

import { color, motion } from '@/theme/tokens';

import { Portal, useEscape, usePresence } from './overlay';
import { cx } from './primitives';
import styles from './Sheet.module.css';

export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
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
      <div role="dialog" aria-modal className={cx(styles.sheet, open && styles.sheetOpen)}>
        <div className={styles.grab} />
        {children}
      </div>
    </Portal>
  );
}

export function SheetGroup({ children }: { children: ReactNode }) {
  return <div className={styles.group}>{String(children).toUpperCase()}</div>;
}

export function SheetItem({
  glyph,
  label,
  meta,
  onPress,
  danger,
  disabled,
}: {
  /** A text glyph, or a render function receiving the resolved colour. */
  glyph: string | ((tint: string) => ReactNode);
  label: string;
  meta?: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const tint = danger ? color.error : color.textSecondary;
  return (
    <button type="button" onClick={onPress} disabled={disabled} className={styles.item}>
      {typeof glyph === 'string' ? (
        <span className={styles.itemGlyph} style={{ color: tint }}>
          {glyph}
        </span>
      ) : (
        <span className={styles.itemIcon}>{glyph(tint)}</span>
      )}
      <span className={cx(styles.itemLabel, danger && styles.itemDanger)}>{label}</span>
      {meta ? <span className={styles.itemMeta}>{meta}</span> : null}
    </button>
  );
}

export function SheetSeparator() {
  return <div className={styles.sep} />;
}

export function SheetNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}
