'use client';

import { useRouter } from 'next/navigation';

import { ChevronLeftIcon } from '@/components/icons';
import { AppBar, AppBarIcon, AppBarTitle, Row, SectionLabel, Toggle } from '@/components/primitives';
import { Screen, ScreenBody } from '@/components/Screen';
import { languageName } from '@/data/languages';
import { useLive } from '@/state/liveStore';
import { useSettings } from '@/state/settingsStore';

import styles from '../settings.module.css';

export default function TranslationSettings() {
  const router = useRouter();
  const prefs = useSettings((s) => s.prefs);
  const setPref = useSettings((s) => s.set);

  const speakerOrder = useLive((s) => s.speakerOrder);
  const speakerNames = useLive((s) => s.speakerNames);

  const twoWay = prefs.translationType === 'two_way';

  const namedCount = speakerOrder.filter((id) => speakerNames[id]).length;

  return (
    <Screen>
      <AppBar>
        <AppBarIcon
          glyph={(tint) => <ChevronLeftIcon color={tint} />}
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <AppBarTitle>Translation</AppBarTitle>
      </AppBar>

      <ScreenBody className={styles.body}>
        <SectionLabel>Languages</SectionLabel>
        <Row
          label="Translation type"
          value={twoWay ? 'Two-way' : 'One-way'}
          chevron
          onPress={() => setPref('translationType', twoWay ? 'one_way' : 'two_way')}
        />
        {twoWay ? (
          <>
            <Row
              label="Language A"
              value={languageName(prefs.languageA)}
              chevron
              onPress={() => router.push('/language-picker?target=a')}
            />
            <Row
              label="Language B"
              value={languageName(prefs.languageB)}
              chevron
              onPress={() => router.push('/language-picker?target=b')}
            />
          </>
        ) : (
          <>
            <Row
              label="Source"
              value={languageName(prefs.sourceLanguage)}
              chevron
              onPress={() => router.push('/language-picker?target=source')}
            />
            <Row
              label="Target"
              value={languageName(prefs.targetLanguage)}
              chevron
              onPress={() => router.push('/language-picker?target=target')}
            />
          </>
        )}

        <SectionLabel>Advanced</SectionLabel>
        <Row
          label="Strict language"
          sub="Reject text outside the source language"
          right={
            <Toggle
              value={prefs.languageHintsStrict}
              onChange={(v) => setPref('languageHintsStrict', v)}
              accessibilityLabel="Accept the source language only"
            />
          }
        />
        <Row
          label="Endpoint delay"
          sub="Silence before a turn is finalised"
          value={`${prefs.endpointDelay} ms`}
          chevron
          onPress={() =>
            setPref('endpointDelay', prefs.endpointDelay >= 5000 ? 1500 : prefs.endpointDelay + 500)
          }
        />

        <SectionLabel>Speakers</SectionLabel>
        <Row
          label="Speaker detection"
          sub="Up to 15 per session"
          right={
            <Toggle
              value={prefs.speakerDetection}
              onChange={(v) => setPref('speakerDetection', v)}
              accessibilityLabel="Speaker detection"
            />
          }
        />
        <Row
          label="Manage speakers"
          sub={`${speakerOrder.length} detected · ${namedCount} named`}
          chevron
          disabled={speakerOrder.length === 0}
        />
        <Row
          label="Auto-identify names"
          sub="Uses AI to detect names from conversation"
          right={
            <Toggle
              value={prefs.autoIdentifySpeakers}
              onChange={(v) => setPref('autoIdentifySpeakers', v)}
              accessibilityLabel="Auto-identify speaker names"
            />
          }
        />
        <Row
          label="Show speaker chip"
          sub="Colour rail always shown"
          right={
            <Toggle
              value={prefs.showSpeakerChip}
              onChange={(v) => setPref('showSpeakerChip', v)}
              accessibilityLabel="Show speaker labels"
            />
          }
        />
      </ScreenBody>
    </Screen>
  );
}
