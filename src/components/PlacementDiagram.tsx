/**
 * The phone-placement illustration from onboarding.
 *
 * No other translator app tells you where to stand your phone, and capture
 * quality is the single biggest risk to the whole experience — a phone face-down
 * two metres from the speaker produces confident nonsense, not an error. So the
 * geometry gets drawn rather than described.
 *
 * Ported coordinate-for-coordinate from the `react-native-svg` original; the
 * viewBox and every path are unchanged.
 */
import { color } from '@/theme/tokens';

import styles from './PlacementDiagram.module.css';

export function PlacementDiagram() {
  return (
    <div className={styles.frame}>
      <svg width="100%" height="100%" viewBox="0 0 280 150" role="img" aria-label="Stand the phone about 30 centimetres from the laptop speaker, screen toward you">
        {/* laptop */}
        <rect x="26" y="42" width="96" height="62" rx="4" fill="#22222E" />
        <rect x="32" y="48" width="84" height="48" rx="2" fill="#12121A" />
        <rect x="14" y="104" width="120" height="8" rx="3" fill="#2B2B39" />

        {/* sound radiating toward the phone */}
        <g fill="none" stroke={color.accent} strokeWidth={2} strokeLinecap="round">
          <path d="M140 75 a 22 22 0 0 1 0 -30" opacity={0.75} />
          <path d="M152 84 a 34 34 0 0 0 0 -48" opacity={0.55} />
          <path d="M164 93 a 46 46 0 0 0 0 -66" opacity={0.3} />
        </g>

        {/* phone, tilted and standing */}
        <g transform="rotate(-9 218 72)">
          <rect x="196" y="30" width="44" height="84" rx="8" fill="#0F0F16" />
          <rect x="200" y="35" width="36" height="70" rx="4" fill="#1A2340" />
          <circle cx="218" cy="110" r="3" fill={color.success} />
        </g>

        <text x="228" y="132" fill={color.success} fontSize="9" textAnchor="middle">
          mic ↑
        </text>

        {/* distance callout */}
        <line
          x1="126"
          y1="124"
          x2="196"
          y2="124"
          stroke={color.textMuted}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <text x="161" y="120" fill={color.textMuted} fontSize="9" textAnchor="middle">
          ~30 cm
        </text>
      </svg>
    </div>
  );
}
