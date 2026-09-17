'use client';

import { useRouter } from 'next/navigation';

import { ChevronLeftIcon } from '@/components/icons';
import { AppBar, AppBarIcon, AppBarTitle, Row, SectionLabel } from '@/components/primitives';
import { Screen, ScreenBody } from '@/components/Screen';
import { Slider } from '@/components/Slider';
import { useSettings } from '@/state/settingsStore';
import { MAX_TRANSCRIPT_SIZE, MIN_TRANSCRIPT_SIZE } from '@/theme/tokens';

import styles from '../settings.module.css';

export default function DisplaySettings() {
  const router = useRouter();
  const prefs = useSettings((s) => s.prefs);
  const setPref = useSettings((s) => s.set);

  return (
    <Screen>
      <AppBar>
        <AppBarIcon
          glyph={(tint) => <ChevronLeftIcon color={tint} />}
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <AppBarTitle>Display</AppBarTitle>
      </AppBar>

      <ScreenBody className={styles.body}>
        <SectionLabel>Text size</SectionLabel>
        <div className={styles.preview}>
          <span
            className={styles.previewText}
            style={{ fontSize: prefs.fontSize, lineHeight: `${prefs.fontSize * 1.4}px` }}>
            Revenue is up twelve percent.
          </span>
        </div>
        <Slider
          value={prefs.fontSize}
          min={MIN_TRANSCRIPT_SIZE}
          max={MAX_TRANSCRIPT_SIZE}
          step={2}
          onChange={(v) => setPref('fontSize', v)}
          minLabel={String(MIN_TRANSCRIPT_SIZE)}
          maxLabel={String(MAX_TRANSCRIPT_SIZE)}
          valueLabel={`${prefs.fontSize} px`}
          accessibilityLabel="Translation text size"
        />

        {/* Live is translation-only, and there is one layout: two panels, one
            per language. The source text lives in the Library transcript. */}
        <SectionLabel>Layout</SectionLabel>
        <Row
          label="Max lines kept"
          sub="Older lines stay one “View more” away"
          value={String(prefs.maxLinesKept)}
          chevron
          onPress={() =>
            setPref('maxLinesKept', prefs.maxLinesKept >= 900 ? 100 : prefs.maxLinesKept + 200)
          }
        />

        <SectionLabel>Appearance</SectionLabel>
        <Row label="Theme" value="Dark" disabled />
      </ScreenBody>
    </Screen>
  );
}
