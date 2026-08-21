/**
 * Settings root — the desktop's four cards, restated as a grouped list where
 * every row's subtitle shows the current state rather than making the user open
 * the screen to find out.
 */
'use client';

import { useRouter } from 'next/navigation';

import { ChevronLeftIcon } from '@/components/icons';
import { AppBar, AppBarIcon, AppBarTitle, Row, SectionLabel, Toggle } from '@/components/primitives';
import { Screen, ScreenBody } from '@/components/Screen';
import { shortCode } from '@/data/languages';
import { OPENAI_SUMMARY_MODEL } from '@/lib/summary/model';
import { resolveLanguage, useSettings } from '@/state/settingsStore';

import styles from './settings.module.css';

const VERSION = '1.0.0';

export default function SettingsRoot() {
  const router = useRouter();
  const prefs = useSettings((s) => s.prefs);
  const setPref = useSettings((s) => s.set);

  // Same rule as Live: source may genuinely be AUTO (Soniox detects it), but the
  // target never is — 'auto' means "follow the device", so show what it resolves
  // to rather than a second, meaningless AUTO.
  const langPair = `${shortCode(prefs.sourceLanguage)} → ${shortCode(resolveLanguage(prefs.targetLanguage))}`;
  const typeLabel = prefs.translationType === 'two_way' ? 'Two-way' : 'One-way';

  return (
    <Screen>
      <AppBar>
        <AppBarIcon
          glyph={(tint) => <ChevronLeftIcon color={tint} />}
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <AppBarTitle>Settings</AppBarTitle>
      </AppBar>

      <ScreenBody className={styles.body}>
        <SectionLabel>Configuration</SectionLabel>
        <Row
          glyph="🌐"
          label="Translation"
          sub={`${langPair} · ${typeLabel} · Speakers ${prefs.speakerDetection ? 'on' : 'off'}`}
          chevron
          onPress={() => router.push('/settings/translation')}
        />
        <Row
          glyph="🔊"
          label="Speech"
          sub="Not in this build"
          chevron
          onPress={() => router.push('/settings/speech')}
        />
        {/* The mockup's Settings root predates the summary feature and has no
            row for it; without one the screen would be unreachable. */}
        <Row
          glyph="✨"
          label="AI summary"
          sub={`OpenAI · ${OPENAI_SUMMARY_MODEL}`}
          chevron
          onPress={() => router.push('/settings/summary')}
        />
        <Row
          glyph="▦"
          label="Display"
          sub={`${prefs.fontSize} px · ${prefs.viewMode === 'panels' ? 'Speaker panels' : 'Stream'}`}
          chevron
          onPress={() => router.push('/settings/display')}
        />

        <SectionLabel>Session</SectionLabel>
        <Row
          glyph="☀"
          label="Keep screen awake"
          sub="While a session is running"
          right={
            <Toggle
              value={prefs.keepAwake}
              onChange={(v) => setPref('keepAwake', v)}
              accessibilityLabel="Keep screen awake"
            />
          }
        />
        <Row
          glyph="🔔"
          label="Background listening"
          sub="Keep capturing when the tab is hidden"
          right={
            <Toggle
              value={prefs.backgroundListening}
              onChange={(v) => setPref('backgroundListening', v)}
              accessibilityLabel="Background listening"
            />
          }
        />
        <Row
          glyph="💲"
          label="Cost warnings"
          sub="Alert past $1.00 per session"
          right={
            <Toggle
              value={prefs.costWarnings}
              onChange={(v) => setPref('costWarnings', v)}
              accessibilityLabel="Cost warnings"
            />
          }
        />

        <SectionLabel>About</SectionLabel>
        <Row glyph="ⓘ" label="About" value={`v${VERSION}`} />
        {/*
          Reworded from the mobile build, which said "keys on-device". Neither
          half of that holds here: the keys are on the server and never reach
          the browser, and sessions sync to a database rather than living on one
          device. Saying so is the entire point of the row.
        */}
        <Row
          glyph="🛡"
          label="Privacy"
          sub="No account · no telemetry · keys never leave the server"
        />
      </ScreenBody>
    </Screen>
  );
}
