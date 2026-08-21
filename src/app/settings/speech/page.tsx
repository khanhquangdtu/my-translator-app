/**
 * Speech (TTS) — present but inert in this build.
 *
 * Narration is deferred to a later milestone. The screen still ships so the
 * shape of the feature is visible and Settings doesn't have a hole in it, using
 * the same disabled treatment the mockup applies to its own not-yet-shipped
 * provider row.
 *
 * Every row passes `glyph=""` rather than omitting it: the empty string still
 * renders the 22px glyph column, so these labels stay aligned with the ones on
 * every other Settings screen.
 */
'use client';

import { useRouter } from 'next/navigation';

import { ChevronLeftIcon } from '@/components/icons';
import { AppBar, AppBarIcon, AppBarTitle, Banner, Row, SectionLabel } from '@/components/primitives';
import { Screen, ScreenBody } from '@/components/Screen';

import styles from '../settings.module.css';

export default function SpeechSettings() {
  const router = useRouter();

  return (
    <Screen>
      <AppBar>
        <AppBarIcon
          glyph={(tint) => <ChevronLeftIcon color={tint} />}
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <AppBarTitle>Speech</AppBarTitle>
      </AppBar>

      <ScreenBody className={styles.body}>
        <Banner
          tone="info"
          glyph="ⓘ"
          text="Reading translations aloud is coming in a later release. This build shows text only."
        />

        <SectionLabel>Provider</SectionLabel>
        <Row glyph="" label="Edge TTS" sub="Free · neural · 40+ languages" disabled />
        <Row glyph="" label="Google Chirp 3 HD" sub="Free 1M chars/mo · needs API key" disabled />
        <Row glyph="" label="ElevenLabs" sub="~$5/mo+ · premium" disabled />

        <SectionLabel>Voice</SectionLabel>
        <Row glyph="" label="No voices yet" sub="Coming in a later release" disabled />
      </ScreenBody>
    </Screen>
  );
}
