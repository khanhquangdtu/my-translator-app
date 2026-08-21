/**
 * Design tokens — transcribed from mockup_2.html.
 *
 * Ported verbatim from the Expo app (rovato/src/theme/tokens.ts). Only the two
 * values that referenced a React Native API changed: `motion.easing` is now a
 * CSS timing function and `tabular` a CSS property. Every colour, radius,
 * space and font size is byte-identical, and tokens.css mirrors them so CSS
 * Modules and TypeScript cannot drift apart.
 *
 * The mockup's greyscale is entirely percentage-alpha white; those alphas ARE
 * the system, so they are declared once here rather than flattened to hex.
 * Values that were translucent in the WebView (`--bg-input`, `--bg-glass`) are
 * given opaque equivalents: React Native has no window transparency, and the
 * mockup's own token legend lists the opaque values to use on mobile.
 */


export const color = {
  /** outer page / lock-screen ground */
  page: '#08080C',
  /** screen background */
  bgPrimary: '#0F0F14',
  /** cards, diagrams */
  bgSecondary: '#191923',
  /** fields, pills, icon buttons — opaque form of rgba(40,40,55,.7) */
  bgInput: '#282837',
  /** action bar — opaque form of rgba(30,30,45,.72) */
  bgGlass: '#1E1E2D',
  /** switch off-track, segmented selected — opaque form of rgba(60,60,80,.5) */
  bgHover: '#3C3C50',
  /** bottom sheet body */
  bgSheet: '#14141C',

  borderSubtle: 'rgba(255,255,255,0.07)',
  borderLight: 'rgba(255,255,255,0.12)',

  textPrimary: 'rgba(255,255,255,0.92)',
  textSecondary: 'rgba(255,255,255,0.55)',
  textMuted: 'rgba(255,255,255,0.35)',
  /** in-flight / provisional text, and the source line under a translation */
  textProvisional: 'rgba(255,255,255,0.40)',
  /** a turn that has scrolled back into history */
  textOld: 'rgba(255,255,255,0.62)',
  textOldSrc: 'rgba(255,255,255,0.26)',
  textLiveSrc: 'rgba(255,255,255,0.24)',

  accent: '#638CFF',
  accentGlow: 'rgba(99,140,255,0.15)',
  accentBorder: 'rgba(99,140,255,0.40)',

  success: '#4ADE80',
  warning: '#FBBF24',
  error: '#F87171',

  /** banner tints */
  warnBg: 'rgba(251,191,36,0.10)',
  warnBorder: 'rgba(251,191,36,0.30)',
  warnText: '#FDE68A',
  warnSoftBg: 'rgba(251,191,36,0.07)',
  warnSoftBorder: 'rgba(251,191,36,0.18)',
  errBg: 'rgba(248,113,113,0.10)',
  errBorder: 'rgba(248,113,113,0.32)',
  errText: '#FECACA',
  /**
   * Swipe-to-delete action panel. `errBg` composited over `bgPrimary` and
   * flattened: the panel sits *behind* the row, so a translucent tint would
   * show the row's own background through it as it slides away.
   */
  bgDanger: '#26191D',

  scrim: 'rgba(0,0,0,0.55)',
  white: '#FFFFFF',
} as const;

/** 2px left rail on a turn, keyed by speaker index mod 4 */
export const speakerRail = ['#638CFF', '#4ADE80', '#FBBF24', '#C084FC'] as const;
/** the lighter tint used for the speaker's name label */
export const speakerLabel = ['#8AA8FF', '#7EE0A4', '#FCD063', '#D3A6FD'] as const;

export function railFor(speakerIndex: number) {
  return speakerRail[speakerIndex % speakerRail.length];
}
export function labelFor(speakerIndex: number) {
  return speakerLabel[speakerIndex % speakerLabel.length];
}

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

/** 4pt base grid */
export const space = {
  /** horizontal screen gutter used by every list row and content block */
  gutter: 18,
  appBarH: 44,
  statusStripH: 38,
  ctaH: 48,
  touch: 48,
} as const;

export const motion = {
  fast: 150,
  normal: 250,
  /** the mockup's easing curve, as a CSS timing function */
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/**
 * Type scale.
 *
 * The transcript default is 18. The mockup's own token legend still says 28pt,
 * but that line is inherited verbatim from the desktop stylesheet and was never
 * revised for phones; the screens themselves disagree with it. What the design
 * actually specifies is the ⋯ sheet reading `Text size · 18 px`, and the
 * artboard confirms it: `.dst` is 13.5px in a 302px-wide frame, which scales to
 * ~17.4 on a real ~390dp screen. 28 is a desktop-monitor number and reads as
 * enormous in the hand.
 */
export const font = {
  family: 'Inter',
  dstPortrait: 18,
  dstLandscape: 26,
  dstArchive: 15,
  srcPortrait: 12.5,
  srcLandscape: 15,
  who: 10.5,
  newest: 9.5,
  rowLabel: 14.5,
  rowSub: 12,
  rowValue: 13.5,
  secLabel: 10.5,
  pill: 12,
  appBarTitle: 15,
  cta: 15.5,
} as const;

export const DEFAULT_TRANSCRIPT_SIZE = 16;
export const MIN_TRANSCRIPT_SIZE = 12;
export const MAX_TRANSCRIPT_SIZE = 48;

/** tabular figures for every clock, elapsed timer and cost readout */
export const tabular = { fontVariantNumeric: 'tabular-nums' } as const;
