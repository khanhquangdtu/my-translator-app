/**
 * The component vocabulary of the mockup, ported from the Expo app's
 * `components/primitives.tsx`. Same names, same props, same numbers — the
 * screens that use them barely changed as a result.
 *
 * The measurements live in `primitives.module.css`, not here.
 */
'use client';

import type { CSSProperties, ReactNode } from 'react';

import { color } from '@/theme/tokens';

import { ChevronDownIcon, ChevronRightIcon } from './icons';
import styles from './primitives.module.css';

export { styles };

/** Joins class names, dropping the falsy branches of a conditional. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

// ─── Text ──────────────────────────────────────────────────────────────

export function Txt({
  children,
  className,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  numberOfLines?: number;
}) {
  return (
    <span className={cx(styles.txt, numberOfLines === 1 && styles.clamp1, className)} style={style}>
      {children}
    </span>
  );
}

// ─── App bar ───────────────────────────────────────────────────────────

export function AppBar({ children }: { children: ReactNode }) {
  return <header className={styles.appBar}>{children}</header>;
}

export function AppBarTitle({
  children,
  muted,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: CSSProperties;
}) {
  return (
    <h1 className={cx(styles.appBarTitle, muted && styles.appBarTitleMuted)} style={style}>
      {children}
    </h1>
  );
}

/** 30×30 glyph slot in the app bar — distinct from the 44×44 `IconBtn`. */
export function AppBarIcon({
  glyph,
  onPress,
  active,
  accessibilityLabel,
}: {
  /**
   * Either a text glyph, or a render function receiving the resolved colour so
   * a drawn icon tints exactly like a typed one does.
   */
  glyph: string | ((tint: string) => ReactNode);
  onPress?: () => void;
  active?: boolean;
  accessibilityLabel: string;
}) {
  const tint = active ? color.accent : color.textSecondary;
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={accessibilityLabel}
      aria-pressed={active}
      className={cx(styles.appBarIcon, active && styles.appBarIconActive)}>
      {typeof glyph === 'string' ? (
        <span className={styles.appBarIconGlyph}>{glyph}</span>
      ) : (
        glyph(tint)
      )}
    </button>
  );
}

/**
 * App-bar action carrying a word as well as a glyph.
 *
 * The bar is otherwise all `AppBarIcon`, because ⚙ and 🏠 need no caption. An
 * icon for "put this app on your home screen" has no such convention to lean
 * on, and the action is one the user has to opt into rather than discover by
 * poking — so it says what it is.
 */
export function AppBarButton({
  glyph,
  children,
  onPress,
  accessibilityLabel,
}: {
  glyph: (tint: string) => ReactNode;
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={accessibilityLabel}
      className={styles.appBarButton}>
      {glyph(color.textSecondary)}
      <span className={styles.appBarButtonLabel}>{children}</span>
    </button>
  );
}

// ─── Status dot ────────────────────────────────────────────────────────

export type DotTone = 'idle' | 'live' | 'warn' | 'error';

const DOT_COLORS: Record<DotTone, string> = {
  idle: color.textMuted,
  live: color.success,
  warn: color.warning,
  error: color.error,
};

export function StatusDot({ tone, pulse }: { tone: DotTone; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(styles.dot, pulse && styles.dotPulse)}
      style={{ background: DOT_COLORS[tone] }}
    />
  );
}

// ─── Pill ──────────────────────────────────────────────────────────────

export function Pill({
  children,
  onPress,
  caret,
  tone,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  caret?: boolean;
  tone?: 'default' | 'success';
  accessibilityLabel?: string;
}) {
  const className = cx(
    styles.pill,
    tone === 'success' && styles.pillSuccess,
    onPress && styles.pillPressable
  );
  const body = (
    <>
      <span>{children}</span>
      {caret ? <ChevronDownIcon size={11} color={color.textMuted} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <span className={className} aria-label={accessibilityLabel}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" onClick={onPress} aria-label={accessibilityLabel} className={className}>
      {body}
    </button>
  );
}

// ─── Buttons ───────────────────────────────────────────────────────────

export function Cta({
  label,
  onPress,
  variant = 'primary',
  disabled,
  flex,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'stop' | 'ghost';
  disabled?: boolean;
  flex?: number;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      style={flex !== undefined ? { flex } : undefined}
      className={cx(
        styles.cta,
        variant === 'stop' && styles.ctaStop,
        variant === 'ghost' && styles.ctaGhost
      )}>
      {label}
    </button>
  );
}

export function IconBtn({
  glyph,
  onPress,
  on,
  danger,
  disabled,
  accessibilityLabel,
}: {
  glyph: string;
  onPress?: () => void;
  on?: boolean;
  danger?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={accessibilityLabel}
      aria-pressed={on}
      className={cx(styles.iconBtn, on && styles.iconBtnOn, danger && styles.iconBtnDanger)}>
      {glyph}
    </button>
  );
}

// ─── Grouped list ──────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className={styles.secLabel}>{String(children).toUpperCase()}</div>;
}

export function Row({
  glyph,
  label,
  sub,
  value,
  chevron,
  right,
  onPress,
  disabled,
  danger,
  selected,
}: {
  glyph?: string;
  label: string;
  sub?: string;
  value?: string;
  chevron?: boolean;
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
  selected?: boolean;
}) {
  const inert = disabled || !onPress;
  const body = (
    <>
      {glyph !== undefined ? (
        <span className={cx(styles.rowGlyph, selected && styles.rowGlyphSelected)}>{glyph}</span>
      ) : null}
      <span className={styles.rowMiddle}>
        <span className={cx(styles.rowLabel, danger && styles.rowLabelDanger)}>{label}</span>
        {sub ? <span className={styles.rowSub}>{sub}</span> : null}
      </span>
      {value ? <span className={styles.rowValue}>{value}</span> : null}
      {right}
      {chevron ? <ChevronRightIcon size={15} color={color.textMuted} /> : null}
    </>
  );

  const className = cx(
    styles.row,
    !inert && styles.rowPressable,
    disabled && styles.rowDisabled
  );

  // A row with `right` (a Toggle) but no onPress must not be a button — it
  // would swallow the switch's own click.
  if (inert) {
    return <div className={className}>{body}</div>;
  }
  return (
    <button type="button" onClick={onPress} className={className}>
      {body}
    </button>
  );
}

// ─── Switch ────────────────────────────────────────────────────────────

export function Toggle({
  value,
  onChange,
  accessibilityLabel,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  accessibilityLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={accessibilityLabel}
      onClick={() => onChange(!value)}
      className={cx(styles.switchTrack, value && styles.switchTrackOn)}>
      <span className={cx(styles.switchThumb, value && styles.switchThumbOn)} />
    </button>
  );
}

// ─── Segmented control ─────────────────────────────────────────────────

export function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className={styles.segWrap}>
      <div className={styles.seg}>
        {options.map((opt) => {
          const on = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={on}
              className={cx(styles.segItem, on && styles.segItemOn)}>
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Field ─────────────────────────────────────────────────────────────

export function Field({
  value,
  onChangeText,
  placeholder,
  secure,
  leading,
  trailing,
  autoFocus,
  monospace,
  onSubmit,
}: {
  value: string;
  onChangeText?: (next: string) => void;
  placeholder?: string;
  secure?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  autoFocus?: boolean;
  monospace?: boolean;
  /** Enter on the soft keyboard — the web's equivalent of onSubmitEditing. */
  onSubmit?: () => void;
}) {
  return (
    <div className={styles.field}>
      {leading}
      <input
        className={cx(styles.fieldInput, monospace && styles.fieldInputMono)}
        value={value}
        onChange={(e) => onChangeText?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) onSubmit();
        }}
        placeholder={placeholder}
        type={secure ? 'password' : 'text'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        // Matches the mobile screens, where the search and rename fields open
        // already focused — the dialog exists to be typed into.
        autoFocus={autoFocus}
        readOnly={!onChangeText}
      />
      {trailing}
    </div>
  );
}

// ─── Banner ────────────────────────────────────────────────────────────

const BANNER_TONE = {
  warn: styles.bannerWarn,
  warnSoft: styles.bannerWarnSoft,
  error: styles.bannerError,
  info: styles.bannerInfo,
} as const;

export function Banner({
  glyph,
  text,
  tone,
  action,
  onAction,
}: {
  glyph?: string;
  text: string;
  tone: keyof typeof BANNER_TONE;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className={cx(styles.banner, BANNER_TONE[tone])} role="status">
      {glyph ? <span className={styles.bannerGlyph}>{glyph}</span> : null}
      <span className={styles.bannerText}>{text}</span>
      {action ? (
        <button type="button" onClick={onAction} className={styles.bannerAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}

// ─── Misc ──────────────────────────────────────────────────────────────

export function Divider() {
  return <div className={styles.divider} />;
}

export function Spacer({ h }: { h: number }) {
  return <div style={{ height: h }} />;
}
