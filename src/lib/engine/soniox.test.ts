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
 * The answer a translated token carries is `source_language`. `language` is the
 * language its own text is written in — the other side of the pair — and the
 * cases below fix which is read as what, because reading them the wrong way
 * round does not fail loudly: it pairs the translation with a turn that was
 * never waiting, while the turn that really was stays pending, its `dst` empty,
 * and a panel skips a turn with no translation entirely.
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
  source_language?: string;
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

  return {
    engine,
    feed: (tokens: SonioxToken[]) => internals.handleResponse({ tokens }),
    translations,
    previews,
  };
}

const TWO_WAY: EngineConfig = { translationType: 'two_way', languageA: 'vi', languageB: 'en' };

describe('two-way translation routing', () => {
  it('takes the spoken language from source_language, not the frame', () => {
    const { feed, translations } = engineWith(TWO_WAY);

    // The English speaker's translation (written in Vietnamese) arrives in the
    // same frame as the Vietnamese speaker's first words.
    feed([
      { text: 'Xin chao', is_final: true, language: 'vi', translation_status: 'original' },
      {
        text: 'Xin chao cac ban',
        is_final: true,
        language: 'vi',
        source_language: 'en',
        translation_status: 'translation',
      },
    ]);

    expect(translations).toEqual([['Xin chao cac ban', 'en']]);
  });

  it('splits a frame carrying both directions into two turns', () => {
    const { feed, translations } = engineWith(TWO_WAY);

    feed([
      {
        text: 'Good morning',
        is_final: true,
        language: 'en',
        source_language: 'vi',
        translation_status: 'translation',
      },
      {
        text: 'Chao buoi sang',
        is_final: true,
        language: 'vi',
        source_language: 'en',
        translation_status: 'translation',
      },
    ]);

    expect(translations).toEqual([
      ['Good morning', 'vi'],
      ['Chao buoi sang', 'en'],
    ]);
  });

  it('reads an unattributed token as written in the target language', () => {
    const { feed, translations } = engineWith(TWO_WAY);

    // Nothing but `language` to go on: a line written in B was said in A.
    feed([
      { text: 'Xin chao cac ban', is_final: true, language: 'vi', translation_status: 'translation' },
    ]);

    expect(translations).toEqual([['Xin chao cac ban', 'en']]);
  });

  it('refuses to guess when the translation says nothing at all', () => {
    const { feed, translations } = engineWith(TWO_WAY);

    feed([
      { text: 'Xin chao', is_final: true, language: 'vi', translation_status: 'original' },
      { text: 'Hello', is_final: true, translation_status: 'translation' },
    ]);

    // Null falls back to FIFO pairing, which is a guess the store makes
    // knowingly - better than naming the wrong speaker with confidence.
    expect(translations).toEqual([['Hello', null]]);
  });

  it('routes by the reconfigured pair, not the one it started with', () => {
    const { engine, feed, translations } = engineWith(TWO_WAY);

    // The user re-picks a panel language mid-session. There is no socket in
    // this test, so `reconfigure` only stores the config — which is exactly
    // the seam routing reads.
    engine.reconfigure({ translationType: 'two_way', languageA: 'vi', languageB: 'fr' });

    // Unattributed token written in the new B: said in A under the new pair.
    feed([{ text: 'Bonjour', is_final: true, language: 'fr', translation_status: 'translation' }]);

    expect(translations).toEqual([['Bonjour', 'vi']]);
  });

  it('routes the live preview the same way', () => {
    const { feed, previews } = engineWith(TWO_WAY);

    feed([
      { text: 'Xin ch', language: 'vi', source_language: 'en', translation_status: 'translation' },
    ]);

    expect(previews).toEqual([['Xin ch', 'en']]);
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

    // No source_language and no A/B pair to flip through - the frame's own
    // originals are the answer, because there is only one direction to be in.
    expect(translations).toEqual([['Hello', 'vi']]);
  });
});
