/**
 * Where a block of transcript breaks into lines.
 *
 * Both transcript surfaces group consecutive utterances from one speaker into a
 * single block, which is right — a thought chopped into stripes is harder to
 * read than one paragraph. But the engine finalises an utterance every few
 * seconds, so a speaker holding the floor produces a block that is one unbroken
 * wall of text, and the reader has to find the end of each sentence themselves
 * before they can start on the next one. In a live conversation that costs more
 * time than they have.
 *
 * So the block is broken where its sentences already end. Two rules decide it,
 * and they pull against each other on purpose:
 *
 *  - **Break at a full stop, not before one.** A line ending mid-clause reads
 *    as an interruption; one ending at a full stop reads as finished.
 *  - **Do not break constantly.** A run of three-word sentences broken at every
 *    one is a list, not speech, and it spends the column height the two-way
 *    panels have least of. Anything shorter than `MIN_CHARS` is glued to its
 *    neighbour instead of given a line.
 *
 * Every piece returned is a slice of the original string, never a re-join, so
 * what reaches the screen is character-for-character what the engine sent —
 * spacing included. That matters for the languages this app runs in that write
 * their punctuation flush.
 */

/**
 * A piece shorter than this is glued to its neighbour rather than given a line.
 * Roughly one wrapped line in a two-way panel column at a middling font size,
 * which is where a break starts to look deliberate rather than nervous.
 */
const MIN_CHARS = 24;

/**
 * A piece longer than this is broken at a clause boundary even though no
 * sentence ended. Recognition does sometimes return a long stretch with no full
 * stop in it at all, and one paragraph-length line is the exact thing this
 * module exists to prevent.
 */
const SOFT_MAX_CHARS = 180;

/** Ends a sentence. */
const TERMINATORS = new Set(['.', '!', '?', '…', '。', '！', '？', '．', '؟']);

/** The CJK forms are their own full stop *and* their own following space. */
const CJK_TERMINATORS = new Set(['。', '！', '？', '．']);

/** Quote and bracket marks that belong to the sentence they close. */
const CLOSERS = new Set(['"', "'", '”', '’', '»', ')', ']', '}', '』', '」']);

/** Ends a clause — the fallback break for text that never ends a sentence. */
const CLAUSE = new Set([',', ';', ':', '—', '–', '，', '；', '：', '、']);

/** No sentence ends after these, however much the full stop looks like one. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'vs', 'etc', 'eg', 'ie',
  'no', 'inc', 'ltd', 'co', 'approx', 'al', 'cf', 'fig', 'vol', 'dept', 'univ',
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
  if (!text.trim()) return [];
  const out: string[] = [];
  for (const range of glueShort(scan(text), text)) {
    const piece = text.slice(range.s, range.e);
    if (width(piece, 0, piece.length) > SOFT_MAX_CHARS) out.push(...softBreak(piece));
    else if (piece) out.push(piece);
  }
  return out.length ? out : [text];
}

/**
 * How much room a stretch of text takes, in units of one Latin character.
 *
 * The thresholds above are about how much a line *looks* like, and a character
 * count is only that in an alphabet. A twenty-character Chinese sentence is a
 * whole thought and twice as wide on screen as twenty Latin letters, so counting
 * code points would have glued it to its neighbour as if it were a stray
 * "Right." — which is exactly what it did before this existed. The CJK and
 * full-width blocks count double, which is the same rule a terminal applies.
 */
function width(text: string, s: number, e: number): number {
  let n = 0;
  for (let i = s; i < e; i++) n += isWide(text.charCodeAt(i)) ? 2 : 1;
  return n;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

/** Sentence ranges, before any of them is judged too short to stand alone. */
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

  const ch = text[next];
  return !(ch.toLowerCase() === ch && ch.toUpperCase() !== ch);
}

/**
 * Folds pieces too short to earn a line into the one beside them.
 *
 * Either side being short is enough: a short opener ("Right.") takes the
 * sentence after it, a short closer ("Thanks.") joins the one before. Ranges
 * are merged rather than strings joined, so the original separator survives — a
 * space in English, nothing at all after a `。`.
 */
function glueShort(ranges: Range[], text: string): Range[] {
  const out: Range[] = [];
  for (const range of ranges) {
    const prev = out[out.length - 1];
    if (
      prev &&
      (width(text, range.s, range.e) < MIN_CHARS || width(text, prev.s, prev.e) < MIN_CHARS)
    ) {
      prev.e = range.e;
    } else {
      out.push({ ...range });
    }
  }
  return out;
}

/** Breaks an over-long piece at clause boundaries, or leaves it whole. */
function softBreak(piece: string): string[] {
  const clauses = clauseRanges(piece);
  if (clauses.length < 2) return [piece];

  const out: Range[] = [];
  for (const clause of clauses) {
    const prev = out[out.length - 1];
    if (prev && width(piece, prev.s, clause.e) <= SOFT_MAX_CHARS) prev.e = clause.e;
    else out.push({ ...clause });
  }
  // A tail left under the minimum goes back on the line above — the same rule
  // that applies between sentences.
  const last = out[out.length - 1];
  if (out.length > 1 && width(piece, last.s, last.e) < MIN_CHARS) {
    out[out.length - 2].e = last.e;
    out.pop();
  }
  return out.map((r) => piece.slice(r.s, r.e));
}

function clauseRanges(piece: string): Range[] {
  const out: Range[] = [];
  let start = skipSpace(piece, 0);
  for (let i = start; i < piece.length; i++) {
    if (!CLAUSE.has(piece[i])) continue;
    if (i + 1 >= piece.length) break;
    // Same rule as for a full stop, with the same exemption: the full-width
    // marks carry their own spacing.
    if (!isSpace(piece[i + 1]) && piece.charCodeAt(i) < 0x3000) continue;
    const next = skipSpace(piece, i + 1);
    if (next >= piece.length) break;
    out.push({ s: start, e: trimEnd(piece, start, i + 1) });
    start = next;
    i = start - 1;
  }
  if (start < piece.length) {
    const e = trimEnd(piece, start, piece.length);
    if (e > start) out.push({ s: start, e });
  }
  return out;
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
