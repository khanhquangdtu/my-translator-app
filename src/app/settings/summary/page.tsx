/**
 * Settings · AI summary.
 *
 * There is no key field: summaries run on the credentials the deployment holds.
 * Anthropic and Gemini stay listed because summary quality genuinely differs by
 * model and the cost is per-use rather than per-hour, but only OpenAI is wired
 * up in this build; the other two carry a "Needs key" chip and stay inert.
 */
'use client';

import { useRouter } from 'next/navigation';

import { ChevronLeftIcon } from '@/components/icons';
import {
  AppBar,
  AppBarIcon,
  AppBarTitle,
  Banner,
  Row,
  SectionLabel,
  Toggle,
} from '@/components/primitives';
import { Screen, ScreenBody } from '@/components/Screen';
import { LANGUAGES, languageName } from '@/data/languages';
import { OPENAI_SUMMARY_MODEL } from '@/lib/summary/model';
import { AUTO, deviceLanguage, useSettings } from '@/state/settingsStore';

import styles from '../settings.module.css';

export default function SummarySettings() {
  const router = useRouter();
  const prefs = useSettings((s) => s.prefs);
  const setPref = useSettings((s) => s.set);

  const cycleLanguage = () => {
    const codes = [AUTO, 'en', 'vi', 'ja', 'ko', 'zh', ...LANGUAGES.map((l) => l.code)];
    const unique = Array.from(new Set(codes));
    const next = unique[(unique.indexOf(prefs.summaryLanguage) + 1) % unique.length];
    setPref('summaryLanguage', next);
  };

  return (
    <Screen>
      <AppBar>
        <AppBarIcon
          glyph={(tint) => <ChevronLeftIcon color={tint} />}
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <AppBarTitle>AI summary</AppBarTitle>
      </AppBar>

      <ScreenBody className={styles.body}>
        {/*
          Reworded from mobile, which promised the result was "stored on this
          device" and that "nothing is kept on a server". On the web the request
          goes through our own API route and the summary is stored with the
          session in the database, so the banner says that instead.
        */}
        <Banner
          tone="info"
          glyph="🛡"
          text="The transcript is sent once to the summary provider, through this app's server so the key stays there. The result is stored with the session."
        />

        <SectionLabel>Provider</SectionLabel>
        <Row
          glyph={prefs.summaryProvider === 'openai' ? '✓' : ''}
          selected={prefs.summaryProvider === 'openai'}
          label="OpenAI"
          sub={`${OPENAI_SUMMARY_MODEL} · ~$0.01 per meeting`}
          onPress={() => setPref('summaryProvider', 'openai')}
        />
        <Row glyph="" label="Anthropic" sub="Claude Haiku" right={<NeedsKeyChip />} disabled />
        <Row glyph="" label="Google" sub="Gemini Flash" right={<NeedsKeyChip />} disabled />

        <SectionLabel>Output</SectionLabel>
        <Row
          label="Summary language"
          value={
            prefs.summaryLanguage === AUTO
              ? `Auto (${languageName(deviceLanguage())})`
              : languageName(prefs.summaryLanguage)
          }
          chevron
          onPress={cycleLanguage}
        />
        <Row
          label="Sections"
          sub="TL;DR · Key points · Decisions · Actions · Open questions"
          value="Fixed"
        />
        <Row
          label="Include source-language quotes"
          sub="Attach the original line to each key point"
          right={
            <Toggle
              value={prefs.summaryIncludeQuotes}
              onChange={(v) => setPref('summaryIncludeQuotes', v)}
              accessibilityLabel="Include original sentences"
            />
          }
        />
      </ScreenBody>
    </Screen>
  );
}

function NeedsKeyChip() {
  return <span className={styles.needsKey}>Needs key</span>;
}
