/**
 * Display each sentence on its own line, including short acknowledgements.
 * Decimal points, domains, abbreviations and initials do not end a sentence.
 * The text stays unchanged within each sentence; only surrounding whitespace
 * is removed. Segments supplied by the engine must be split independently.
 */

/** Ends a sentence. */
const TERMINATORS = new Set(['.', '!', '?', '…', '。', '！', '？', '．', '؟']);

/** The CJK forms are their own full stop *and* their own following space. */
const CJK_TERMINATORS = new Set(['。', '！', '？', '．']);

/** Quote and bracket marks that belong to the sentence they close. */
const CLOSERS = new Set(['"', "'", '”', '’', '»', ')', ']', '}', '』', '」']);

/** No sentence ends after these, however much the full stop looks like one. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'vs', 'etc', 'eg', 'ie',
  'inc', 'ltd', 'co', 'approx', 'al', 'cf', 'fig', 'vol', 'dept', 'univ',
  'min', 'max', 'sec', 'est', 'gov', 'tp', 'ts', 'gs', 'pgs', 'ths', 'ks', 'bs',
  'cty', 'tphcm',
]);

type Range = { s: number; e: number };

/**
 * Cached, because the callers re-render at token rate.
 *
 * A live panel rebuilds every line on every provisional token — five to eight
 * times a second — and all but one of those lines is finished text that has not
 * changed since the last frame. Keying on the text itself means only the line
 * actually being spoken is re-scanned; the rest hand back the same array they
 * returned last frame, which is also what lets `TurnView`'s memo keep its
 * subtree.
 *
 * The returned arrays are shared. Callers must treat them as read-only.
 */
const cache = new Map<string, string[]>();
const CACHE_MAX = 512;

/** One entry per line the text should be drawn on, in order. */
export function splitSentences(text: string): string[] {
  const hit = cache.get(text);
  if (hit) return hit;
  const out = compute(text);
  // Wholesale, not LRU: the entries that matter are the ones added in the last
  // second, and a policy that has to be maintained on every lookup costs more
  // than the occasional rebuild of a screen's worth of lines.
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(text, out);
  return out;
}

function compute(text: string): string[] {
  // Explicit line breaks are boundaries too, even without punctuation.
  return text.split(/\r?\n/).flatMap((line) =>
    scan(line).map((range) => line.slice(range.s, range.e))
  );
}

/** Sentence ranges, preserving the text between real sentence boundaries. */
function scan(text: string): Range[] {
  const out: Range[] = [];
  let start = skipSpace(text, 0);

  for (let i = start; i < text.length; i++) {
    if (!TERMINATORS.has(text[i])) continue;

    // "?!" and "..." are one ending, and a quote or bracket closing the
    // sentence belongs to it rather than to the line below.
    let end = i;
    while (end + 1 < text.length && TERMINATORS.has(text[end + 1])) end++;
    const run = end > i;
    while (end + 1 < text.length && CLOSERS.has(text[end + 1])) end++;

    // Trailing punctuation: no next sentence to start, so the remainder below
    // takes it.
    if (end + 1 >= text.length) break;

    // A full stop with nothing after it is a decimal point or a URL, not an
    // ending. The CJK terminators are exempt — they are written flush.
    if (!CJK_TERMINATORS.has(text[i]) && !isSpace(text[end + 1])) {
      i = end;
      continue;
    }

    const next = skipSpace(text, end + 1);
    if (next >= text.length) break;
    if (text[i] === '.' && !run && !endsSentence(text, i, next)) {
      i = end;
      continue;
    }

    out.push({ s: start, e: trimEnd(text, start, end + 1) });
    start = next;
    i = start - 1;
  }

  if (start < text.length) {
    const e = trimEnd(text, start, text.length);
    if (e > start) out.push({ s: start, e });
  }
  return out;
}

/**
 * Whether a bare `.` really ended a sentence.
 *
 * Three ways it does not, all common enough in a transcript to be worth the
 * check: an initial ("J. K."), an abbreviation ("Dr.", "TP."), and a following
 * lower-case letter, which is what a decimal or a mid-sentence pause leaves
 * behind. The case test asks whether the character *has* an upper-case form it
 * differs from, so scripts without case — where every sentence would otherwise
 * look lower-case — do not disqualify a break.
 */
function endsSentence(text: string, dot: number, next: number): boolean {
  let w = dot;
  while (w > 0 && isWordChar(text[w - 1])) w--;
  const word = text.slice(w, dot);
  if (word.length === 1 && isLetter(word)) return false;
  if (ABBREVIATIONS.has(word.toLowerCase())) return false;
  // "No. 5" is a numbered item; "No. Thanks." is two short sentences.
  if (word.toLowerCase() === 'no' && /[0-9]/.test(text[next])) return false;

  const ch = text[next];
  return !(ch.toLowerCase() === ch && ch.toUpperCase() !== ch);
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\u00a0';
}

function isLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

function isWordChar(ch: string): boolean {
  return isLetter(ch) || (ch >= '0' && ch <= '9');
}

function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isSpace(text[i])) i++;
  return i;
}

function trimEnd(text: string, from: number, to: number): number {
  let i = to;
  while (i > from && isSpace(text[i - 1])) i--;
  return i;
}
