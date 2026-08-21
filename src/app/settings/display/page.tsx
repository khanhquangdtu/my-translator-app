'use client';

import { useRouter } from 'next/navigation';

import { ChevronLeftIcon } from '@/components/icons';
import { AppBar, AppBarIcon, AppBarTitle, Row, SectionLabel, Toggle } from '@/components/primitives';
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

        <SectionLabel>Layout</SectionLabel>
        {/* Live is translation-only; the source text lives in the Library
            transcript. What is configurable here is the layout instead. */}
        <Row
          label="Default layout"
          sub={
            prefs.viewMode === 'panels'
              ? 'Speaker panels — one column each, landscape'
              : 'Stream — one column, newest at top'
          }
          value={prefs.viewMode === 'panels' ? 'Panels' : 'Stream'}
          chevron
          onPress={() => setPref('viewMode', prefs.viewMode === 'panels' ? 'stream' : 'panels')}
        />
        <Row
          label="Max lines kept"
          sub="Older lines stay one “View more” away"
          value={String(prefs.maxLinesKept)}
          chevron
          onPress={() =>
            setPref('maxLinesKept', prefs.maxLinesKept >= 900 ? 100 : prefs.maxLinesKept + 200)
          }
        />
        <Row
          label="Auto-hide controls"
          sub="After 3s while translating"
          right={
            <Toggle
              value={prefs.autoHideControls}
              onChange={(v) => setPref('autoHideControls', v)}
              accessibilityLabel="Auto-hide the control bar"
            />
          }
        />
        <Row
          label="Dim in table mode"
          sub="After 60s without interaction"
          right={
            <Toggle
              value={prefs.dimInTableMode}
              onChange={(v) => setPref('dimInTableMode', v)}
              accessibilityLabel="Dim in desk mode"
            />
          }
        />

        <SectionLabel>Appearance</SectionLabel>
        <Row label="Theme" value="Dark" disabled />
      </ScreenBody>
    </Screen>
  );
}
