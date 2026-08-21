/**
 * The frame every screen sits in, plus its entry transition.
 *
 * `presentation` mirrors what `_layout.tsx` declared per route on mobile:
 * everything is a push from the right except the language picker, which was the
 * stack's one `presentation: 'modal'`.
 */
'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cx } from './primitives';
import styles from './Screen.module.css';

export { styles as screenStyles };

export function Screen({
  children,
  presentation = 'card',
}: {
  children: ReactNode;
  presentation?: 'card' | 'modal';
}) {
  return (
    <div className={cx(styles.screen, presentation === 'modal' ? styles.modal : styles.card)}>
      {children}
    </div>
  );
}

/** The bottom action bar — Live, Library detail and onboarding all use it. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className={styles.actionBar}>{children}</div>;
}

/**
 * The scrolling middle of a screen.
 *
 * Takes the full set of div props so callers can attach a scroll listener — the
 * Library closes an open swipe panel on scroll, which is `onScrollBeginDrag` on
 * a FlatList and just `onScroll` here.
 */
export function ScreenBody({
  children,
  className,
  ...rest
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={cx(styles.body, 'noscrollbar', className)} {...rest}>
      {children}
    </div>
  );
}
