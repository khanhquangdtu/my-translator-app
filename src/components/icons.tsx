/**
 * Vector icons, drawn rather than typed.
 *
 * The rest of the app bar uses plain Unicode glyphs (☰, ⚙, ‹) which inherit
 * `color` and so respond to state — an active control turns accent-blue. Emoji
 * cannot do that: they carry their own fixed colours, so 🏠 stayed orange next
 * to a grey ☰ no matter what the style said, and looked like it belonged to a
 * different app.
 *
 * These are inline SVG paths, ported one-for-one from the mobile build's
 * `react-native-svg` versions — same viewBox, same `d`, same stroke weights.
 * They take `color` like any other glyph and cost no package at all.
 */

export type IconProps = {
  size?: number;
  color: string;
};

/** Stroke weight tuned to sit alongside ☰ and ⚙ at app-bar size. */
const STROKE = 1.7;

export function HomeIcon({ size = 17, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M3.5 10.2 12 3.5l8.5 6.7V20a.9.9 0 0 1-.9.9h-4.7v-6.2H9.1v6.2H4.4A.9.9 0 0 1 3.5 20z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Session archive: two upright spines with a third leaning against them. */
export function LibraryIcon({ size = 17, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M4 5h4v14H4z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M9.6 5h4v14h-4z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M16 6.6l3.8 1-2.9 11.1-3.8-1z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Settings.
 *
 * The Unicode ⚙ this replaces is drawn far too finely at app-bar size — its
 * teeth collapse into a fuzzy ring and it reads as an asterisk rather than a
 * gear. This outline is generated geometry: 8 evenly spaced teeth alternating
 * between a tip and a root radius, so every tooth is the same width and the
 * gaps stay open at 17px.
 */
export function SettingsIcon({ size = 17, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M9.92 2.22 L14.08 2.22 L13.81 4.72 L15.86 5.57 L17.45 3.61 L20.39 6.55 L18.43 8.14 L19.28 10.19 L21.78 9.92 L21.78 14.08 L19.28 13.81 L18.43 15.86 L20.39 17.45 L17.45 20.39 L15.86 18.43 L13.81 19.28 L14.08 21.78 L9.92 21.78 L10.19 19.28 L8.14 18.43 L6.55 20.39 L3.61 17.45 L5.57 15.86 L4.72 13.81 L2.22 14.08 L2.22 9.92 L4.72 10.19 L5.57 8.14 L3.61 6.55 L6.55 3.61 L8.14 5.57 L10.19 4.72 Z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.3" stroke={color} strokeWidth={STROKE} />
    </svg>
  );
}

/**
 * Chevrons.
 *
 * The Unicode ‹ › ▾ these replace are typographic marks, not icons: their
 * strokes are hairline at UI sizes and the angle is shallow, so they read as
 * specks rather than as direction. These use a heavier stroke with rounded
 * caps and a fuller angle, which survives being small.
 */
const CHEVRON_STROKE = 2.1;

function Chevron({ d, size, color }: { d: string; size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d={d}
        stroke={color}
        strokeWidth={CHEVRON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 20, color }: IconProps) {
  return <Chevron d="M14.5 5.5 8 12l6.5 6.5" size={size} color={color} />;
}

export function ChevronRightIcon({ size = 16, color }: IconProps) {
  return <Chevron d="M9.5 5.5 16 12l-6.5 6.5" size={size} color={color} />;
}

export function ChevronDownIcon({ size = 12, color }: IconProps) {
  return <Chevron d="M5.5 9.5 12 16l6.5-6.5" size={size} color={color} />;
}

/**
 * Destructive action. Lid, tapered body, two tines — legible at the 19px the
 * swipe panel uses, where a finer bin outline collapses into a grey smudge.
 */
export function TrashIcon({ size = 19, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M4.6 6.9h14.8M9.8 6.9V5.4a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1v1.5M6.6 6.9l.75 12.05a1 1 0 0 0 1 .94h7.3a1 1 0 0 0 1-.94L17.4 6.9"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.4 10.4v5.9M13.6 10.4v5.9"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Search. Replaces the 🔍 emoji, which arrived with its own blue lens and grey
 * handle and so ignored `active` entirely — the app bar's one toggle could not
 * turn accent-blue when search was open, and it read as a coloured smudge next
 * to the monochrome ‹ beside it. Same stroke weight and tint contract as the
 * pencil, so the two sit as one set.
 */
export function SearchIcon({ size = 17, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="10.8" cy="10.8" r="6.3" stroke={color} strokeWidth={STROKE} />
      <path
        d="M15.4 15.4 20.2 20.2"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Rename. Replaces the Unicode `✎`, which renders as a hairline at list size
 * and sank into the background — the affordance was there but nobody could see
 * it. A stroked pencil at the same weight as the rest of the set reads at a
 * glance, and takes `color` so it can sit brighter than the metadata beneath.
 */
export function PencilIcon({ size = 15, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M15.7 4.4a2.05 2.05 0 0 1 2.9 2.9L8 17.9l-3.9 1 1-3.9z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Ferrule line — without it the shape reads as a plain arrow at 15px. */}
      <path
        d="M13.9 6.2l3.9 3.9"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Install: an arrow landing in a tray.
 *
 * Deliberately not the ⤓ glyph or a floppy disk — both read as "download this
 * file". The tray gives the arrow somewhere to arrive, which is the difference
 * between fetching something and putting the app on the device.
 */
export function InstallIcon({ size = 16, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3.6v10.2"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <path
        d="M7.9 10.1 12 14.2l4.1-4.1"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.6 16.1v2.4a1.9 1.9 0 0 0 1.9 1.9h11a1.9 1.9 0 0 0 1.9-1.9v-2.4"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
