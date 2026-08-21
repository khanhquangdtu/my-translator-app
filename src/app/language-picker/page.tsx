/**
 * Language picker — full-screen and searchable, because a 60-item native picker
 * wheel is unusable on a phone. Auto-detect is pinned to the top of the source
 * list, recents come next, then everything else.
 *
 * Presented as a modal (slide up from the bottom), which is what
 * `presentation: 'modal'` gave it in the mobile stack.
 */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

import { AppBar, AppBarIcon, AppBarTitle, cx, Field } from '@/components/primitives';
import { Screen, ScreenBody } from '@/components/Screen';
import {
  AUTO_DETECT,
  findLanguage,
  LANGUAGES,
  languageName,
  type Language,
} from '@/data/languages';
import { AUTO, deviceLanguage, useSettings } from '@/state/settingsStore';

import styles from './language-picker.module.css';

type Target = 'source' | 'target' | 'a' | 'b';

const TITLES: Record<Target, string> = {
  source: 'Source language',
  target: 'Target language',
  a: 'Language A',
  b: 'Language B',
};

type Section = { label: string | null; items: Language[] };

function LanguagePicker() {
  const router = useRouter();
  const params = useSearchParams();
  const target = (params.get('target') as Target) ?? 'source';

  const prefs = useSettings((s) => s.prefs);
  const setPref = useSettings((s) => s.set);
  const rememberLanguage = useSettings((s) => s.rememberLanguage);

  const [query, setQuery] = useState('');

  const current =
    target === 'source'
      ? prefs.sourceLanguage
      : target === 'target'
        ? prefs.targetLanguage
        : target === 'a'
          ? prefs.languageA
          : prefs.languageB;

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (l: Language) =>
      !q || l.name.toLowerCase().includes(q) || l.native.toLowerCase().includes(q) || l.code === q;

    // Both sides get an Auto row, but they mean different things: on the source
    // side Soniox detects the spoken language, on the target side the app
    // follows whatever the browser is set to.
    const autoRow: Language =
      target === 'source'
        ? AUTO_DETECT
        : {
            code: AUTO,
            name: 'Auto',
            native: `device language (${languageName(deviceLanguage())})`,
          };
    const head: Language[] = matches(autoRow) ? [autoRow] : [];

    const recents = prefs.recentLanguages
      .map((code) => findLanguage(code))
      .filter((l): l is Language => !!l && l.code !== AUTO && matches(l));

    const recentCodes = new Set(recents.map((l) => l.code));
    const rest = LANGUAGES.filter((l) => matches(l) && !recentCodes.has(l.code));

    const out: Section[] = [];
    if (head.length) out.push({ label: null, items: head });
    if (recents.length) out.push({ label: 'Recent', items: recents });
    if (rest.length) out.push({ label: 'All languages', items: rest });
    return out;
  }, [query, prefs.recentLanguages, target]);

  const select = (code: string) => {
    if (target === 'source') setPref('sourceLanguage', code);
    else if (target === 'target') setPref('targetLanguage', code);
    else if (target === 'a') setPref('languageA', code);
    else setPref('languageB', code);

    rememberLanguage(code);
    router.back();
  };

  return (
    <Screen presentation="modal">
      <AppBar>
        <AppBarIcon glyph="✕" accessibilityLabel="Close" onPress={() => router.back()} />
        <AppBarTitle>{TITLES[target]}</AppBarTitle>
      </AppBar>

      <div className={styles.search}>
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${LANGUAGES.length}+ languages`}
          leading={<span className={styles.searchGlyph}>🔍</span>}
          autoFocus
        />
      </div>

      <ScreenBody className={styles.list}>
        {sections.map((section) => (
          <div key={section.label ?? 'pinned'}>
            {section.label ? (
              <div className={styles.groupLabel}>{section.label.toUpperCase()}</div>
            ) : null}
            {section.items.map((item) => {
              const selected = item.code === current;
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => select(item.code)}
                  aria-current={selected}
                  className={styles.langRow}>
                  <span className={cx(styles.langName, selected && styles.langNameSelected)}>
                    {selected ? '✓  ' : ''}
                    {item.name}
                  </span>
                  <span className={styles.langNative}>{item.native}</span>
                </button>
              );
            })}
          </div>
        ))}
      </ScreenBody>
    </Screen>
  );
}

export default function LanguagePickerRoute() {
  // useSearchParams needs a boundary for the build's prerender pass; the app
  // never actually renders on the server, so this fallback is never seen.
  return (
    <Suspense fallback={null}>
      <LanguagePicker />
    </Suspense>
  );
}
