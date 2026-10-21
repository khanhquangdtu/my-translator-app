import { describe, expect, it } from 'vitest';

import type { Turn } from '@/state/liveStore';
import type { TwoWayLine } from '@/components/TwoWayPanels';

import { panelLines, recentPanelLines } from './panelLines';

function turn(id: number, dst: string, language = 'en'): Turn {
  return {
    id, dst, language, src: `Source ${id}`, speaker: 'spk-1', speakerIndex: 0,
    pending: false, createdAt: id * 100, ts: '00:01',
  };
}

const defaults = {
  language: 'en', maxLines: 100, provisional: null,
  provisionalDst: null, provisionalDstLang: null,
};

describe('recentPanelLines', () => {
  it('keeps the latest three short utterances in newest-first order', () => {
    const lines = panelLines({ ...defaults, turns: [
      turn(1, 'older'), turn(2, 'hello'), turn(3, 'hi'), turn(4, 'good morning'),
    ] });
    expect(recentPanelLines(lines).flatMap((line) => line.sentences))
      .toEqual(['good morning', 'hi', 'hello']);
  });

  it('counts sentences rather than segments and keeps the newest end of each segment', () => {
    const lines: TwoWayLine[] = [
      { id: 'new', sentences: ['Third.', 'Fourth.'], state: 'final' },
      { id: 'old', sentences: ['First.', 'Second.'], state: 'old' },
    ];
    expect(recentPanelLines(lines)).toEqual([
      { id: 'new', sentences: ['Fourth.', 'Third.'], state: 'final' },
      { id: 'old', sentences: ['Second.'], state: 'old' },
    ]);
    expect(lines[0].sentences).toEqual(['Third.', 'Fourth.']);
    expect(lines[1].sentences).toEqual(['First.', 'Second.']);
  });

  it('includes the live preview within the three-sentence budget', () => {
    const lines = panelLines({
      ...defaults, turns: [turn(1, 'One. Two. Three.')],
      provisional: { text: 'Four', speaker: 'spk-1', speakerIndex: 0, language: 'en' },
    });
    expect(recentPanelLines(lines)).toEqual([
      { id: 'provisional', sentences: ['Four'], state: 'live' },
      { id: 't1', sentences: ['Three.', 'Two.'], state: 'final' },
    ]);
  });

  it('preserves long sentences without truncation and supports fewer than three sentences', () => {
    const text = 'A long sentence with many words '.repeat(30).trim();
    const lines = panelLines({ ...defaults, turns: [turn(1, text)] });
    expect(recentPanelLines(lines)).toEqual(lines);
    expect(recentPanelLines([])).toEqual([]);
  });
});

describe('panelLines', () => {
  it('keeps same-speaker segments separate even without punctuation, newest first', () => {
    const lines = panelLines({ ...defaults, turns: [turn(1, 'Xin chào'), turn(2, 'Tôi là Nam')] });
    expect(lines.map((line) => line.sentences)).toEqual([['Tôi là Nam'], ['Xin chào']]);
    expect(lines.map((line) => line.id)).toEqual(['t2', 't1']);
  });

  it('splits sentences inside a segment without joining short sentences', () => {
    expect(panelLines({ ...defaults, turns: [turn(1, 'Xin chào. Cảm ơn!')] })[0].sentences)
      .toEqual(['Xin chào.', 'Cảm ơn!']);
  });

  it('keeps the in-flight segment separate from final segments of the same speaker', () => {
    const lines = panelLines({
      ...defaults, turns: [turn(1, 'Xin chào.')],
      provisional: { text: 'How are', speaker: 'spk-1', speakerIndex: 0, language: 'en' },
      provisionalDst: 'Bạn khỏe', provisionalDstLang: 'en',
    });
    expect(lines).toEqual([
      { id: 'provisional', sentences: ['Bạn khỏe'], state: 'live' },
      { id: 't1', sentences: ['Xin chào.'], state: 'final' },
    ]);
  });

  it('keeps the final segment identity when the preview finalises', () => {
    const lines = panelLines({ ...defaults, turns: [turn(1, 'Xin chào.'), turn(2, 'Bạn khỏe không?')] });
    expect(lines.map((line) => line.id)).toEqual(['t2', 't1']);
    expect(lines.map((line) => line.sentences)).toEqual([['Bạn khỏe không?'], ['Xin chào.']]);
  });

  it('filters by spoken language and applies the limit to segments', () => {
    const lines = panelLines({
      ...defaults, maxLines: 3,
      turns: [turn(1, 'Một.'), turn(2, 'Hai.'), turn(3, 'Ba.'), turn(4, 'Bốn.'),
        turn(5, 'Other language', 'vi'), turn(6, ''), turn(7, '   ')],
    });
    expect(lines.map((line) => line.id)).toEqual(['t4', 't3', 't2']);
    expect(lines.map((line) => line.state)).toEqual(['final', 'final', 'old']);
  });

  it('does not put a translation preview from the other direction into this panel', () => {
    const lines = panelLines({
      ...defaults, turns: [],
      provisional: { text: 'Hello', speaker: 'spk-1', speakerIndex: 0, language: 'en' },
      provisionalDst: 'Wrong direction', provisionalDstLang: 'vi',
    });
    expect(lines[0].sentences).toEqual(['Hello']);
    expect(panelLines({ ...defaults, language: 'vi', turns: [],
      provisional: { text: 'Hello', speaker: 'spk-1', speakerIndex: 0, language: 'en' },
    })).toEqual([]);
  });
});
