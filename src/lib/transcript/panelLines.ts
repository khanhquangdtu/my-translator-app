import type { TwoWayLine } from '@/components/TwoWayPanels';
import type { Provisional, Turn } from '@/state/liveStore';

import { splitSentences } from './sentences';

/** Latest three sentences, including the newest end of a multi-sentence segment. */
export function recentPanelLines(lines: TwoWayLine[]): TwoWayLine[] {
  const recent: TwoWayLine[] = [];
  let remaining = 3;
  for (const line of lines) {
    if (remaining === 0) break;
    const sentences = line.sentences.slice(-remaining).reverse();
    if (sentences.length === 0) continue;
    recent.push({ ...line, sentences });
    remaining -= sentences.length;
  }
  return recent;
}

/** Keep each recognised segment separate, as in the desktop transcript UI. */
export function panelLines({
  turns,
  language,
  maxLines,
  provisional,
  provisionalDst,
  provisionalDstLang,
}: {
  turns: Turn[];
  language: string;
  maxLines: number;
  provisional: Provisional | null;
  provisionalDst: string | null;
  provisionalDstLang: string | null;
}): TwoWayLine[] {
  const lines: TwoWayLine[] = turns
    .filter((turn) => turn.language === language && turn.dst.trim())
    .slice(-maxLines)
    .reverse()
    .map((turn, index) => ({
      id: `t${turn.id}`,
      sentences: splitSentences(turn.dst),
      state: index < 2 ? 'final' : 'old',
    }));

  if (provisional?.text && provisional.language === language) {
    const dstMatches = !provisionalDstLang || provisionalDstLang === language;
    const text = (dstMatches && provisionalDst) || provisional.text;
    lines.unshift({ id: 'provisional', sentences: splitSentences(text), state: 'live' });
  }

  return lines;
}
