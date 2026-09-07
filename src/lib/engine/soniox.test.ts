/**
 * Which panel a translation belongs to.
 *
 * In two-way mode the answer is not "whichever original came last in the
 * frame". Soniox streams continuously, so one frame routinely carries the
 * finished translation of the utterance that just ended next to the first
 * original tokens of the one that has already started — and those two are in
 * opposite directions. Labelling the translation with the frame's original
 * language sent it to the panel of the person who did not say it, which is the
 * bug these tests exist to keep fixed.
 *
 * The socket is never opened: `handleResponse` is fed frames directly, which is
 * the whole of the routing logic and the only part that needs a network to
 * exercise otherwise.
 */
import { describe, expect, it } from 'vitest';

import { SonioxEngine } from './soniox';
import type { EngineConfig } from './types';

type SonioxToken = {
  text: string;
  is_final?: boolean;
  speaker?: string;
  language?: string;
  translation_status?: 'original' | 'translation' | 'none';
};

/** Reaches past `private` — the seam under test is internal by design. */
type Internals = {
  config: EngineConfig | null;
  handleResponse(data: { tokens: SonioxToken[] }): void;
};

function engineWith(config: EngineConfig) {
  const engine = new SonioxEngine();
  const internals = engine as unknown as Internals;
  internals.config = config;

  const translations: [string, string | null][] = [];
  const previews: [string, string | null][] = [];
  engine.onTranslation = (text, source) => translations.push([text, source]);
  engine.onProvisionalTranslation = (text, source) => previews.push([text, source]);

  return { feed: (tokens: SonioxToken[]) => internals.handleResponse({ tokens }), translations, previews };
}

const TWO_WAY: EngineConfig = { translationType: 'two_way', languageA: 'vi', languageB: 'en' };

describe('two-way translation routing', () => {
  it('credits a translation to the language it was spoken in, not the frame', () => {
    const { feed, translations } = engineWith(TWO_WAY);

    // The English speaker's translation (written in Vietnamese) arrives in the
    // same frame as the Vietnamese speaker's first words.
    feed([
      { text: 'Xin chào', is_final: true, language: 'vi', translation_status: 'original' },
      { text: 'Hello there', is_final: true, language: 'vi', translation_status: 'translation' },
    ]);

    expect(translations).toEqual([['Hello there', 'en']]);
  });

  it('splits a frame carrying both directions into two turns', () => {
    const { feed, translations } = engineWith(TWO_WAY);

    feed([
      { text: 'Good morning', is_final: true, language: 'vi', translation_status: 'translation' },
      { text: 'Chào buổi sáng', is_final: true, language: 'en', translation_status: 'translation' },
    ]);

    expect(translations).toEqual([
      ['Good morning', 'en'],
      ['Chào buổi sáng', 'vi'],
    ]);
  });

  it('refuses to guess when the translation is unlabelled', () => {
    const { feed, translations } = engineWith(TWO_WAY);

    feed([
      { text: 'Xin chào', is_final: true, language: 'vi', translation_status: 'original' },
      { text: 'Hello', is_final: true, translation_status: 'translation' },
    ]);

    // Null falls back to FIFO pairing, which is a guess the store makes
    // knowingly — better than naming the wrong speaker with confidence.
    expect(translations).toEqual([['Hello', null]]);
  });

  it('routes the live preview the same way', () => {
    const { feed, previews } = engineWith(TWO_WAY);

    feed([
      { text: 'Hell', language: 'vi', translation_status: 'translation' },
    ]);

    expect(previews).toEqual([['Hell', 'en']]);
  });
});

describe('one-way translation', () => {
  it('keeps using the spoken language of the frame', () => {
    const { feed, translations } = engineWith({
      translationType: 'one_way',
      targetLanguage: 'en',
    });

    feed([
      { text: 'Xin chào', is_final: true, language: 'vi', translation_status: 'original' },
      { text: 'Hello', is_final: true, language: 'en', translation_status: 'translation' },
    ]);

    expect(translations).toEqual([['Hello', 'vi']]);
  });
});
