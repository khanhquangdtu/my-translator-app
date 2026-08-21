/**
 * Session shapes, derivations and export formats.
 *
 * This is the pure half of the Expo app's `src/storage/sessions.ts`, ported
 * unchanged. The other half — the `expo-file-system` reads and writes — lives
 * in `store.ts`, which speaks IndexedDB and MongoDB instead. Splitting them is
 * what lets the JSON stay byte-identical to the desktop and mobile builds:
 * `SessionData` here is the same record all three write.
 */
import type { Summary } from '@/lib/summary/types';

export type Segment = {
  /** wall-clock offset within the session, "MM:SS" */
  ts: string;
  /** source-language text */
  src: string;
  /** translated text */
  tgt: string;
  /** Soniox speaker id, when diarization produced one */
  speaker?: string | null;
};

export type Chunk = {
  started_at: string;
  ended_at: string | null;
  segments: Segment[];
};

export type SessionData = {
  id: string;
  created_at: string;
  ended_at: string | null;
  title: string;
  engine: string | null;
  source_lang: string;
  target_lang: string;
  duration_sec: number;
  chunks: Chunk[];
  /**
   * Speaker id → display name, as of the end of the session. Persisted so the
   * archive and the summary attribute turns to the same names the user saw
   * live, long after the in-memory roster is gone.
   */
  speaker_names?: Record<string, string>;
  /** AI summary, once one has been generated for this session */
  summary?: Summary | null;
};

export type SessionSummary = {
  id: string;
  title: string;
  created_at: string;
  duration_sec: number;
  source_lang: string;
  target_lang: string;
  speaker_count: number;
  segment_count: number;
  two_way: boolean;
  has_summary: boolean;
};


/** `session-260820-114233` — sortable, and the same shape the desktop used. */
export function generateSessionId(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `session-${String(now.getFullYear()).slice(2)}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}


/**
 * The transcript as the summarizer should see it: oldest first, one turn per
 * block, translation first with the original indented beneath. Speaker names
 * are resolved by the caller so the model can attribute action items to the
 * same names the user sees on screen.
 */
export function toSummaryInput(
  data: SessionData,
  speakerName: (id: string | null | undefined) => string | null
): string {
  const lines: string[] = [];
  for (const chunk of data.chunks) {
    for (const seg of chunk.segments) {
      const who = speakerName(seg.speaker);
      lines.push(`[${seg.ts}] ${who ? `${who}: ` : ''}${seg.tgt || seg.src}`);
      if (seg.tgt && seg.src) lines.push(`    (${seg.src})`);
    }
  }
  return lines.join('\n');
}

/** Display name for a speaker id, honouring any rename saved with the session. */
export function speakerNameIn(data: SessionData, id: string | null | undefined): string | null {
  if (!id) return null;
  const saved = data.speaker_names?.[id];
  if (saved) return saved;
  const order = speakerOrderIn(data);
  const index = order.indexOf(id);
  return `Speaker ${index >= 0 ? index + 1 : 1}`;
}

/** First-seen speaker order, which is also the rail-colour order. */
export function speakerOrderIn(data: SessionData): string[] {
  const order: string[] = [];
  for (const chunk of data.chunks) {
    for (const seg of chunk.segments) {
      if (seg.speaker && !order.includes(seg.speaker)) order.push(seg.speaker);
    }
  }
  return order;
}

export function countTurns(data: SessionData): number {
  return data.chunks.reduce((n, c) => n + c.segments.length, 0);
}


export function summarize(data: SessionData): SessionSummary {
  const speakers = new Set<string>();
  let segmentCount = 0;
  for (const chunk of data.chunks) {
    for (const seg of chunk.segments) {
      segmentCount++;
      if (seg.speaker) speakers.add(seg.speaker);
    }
  }
  return {
    id: data.id,
    title: data.title || autoTitle(data),
    created_at: data.created_at,
    duration_sec: data.duration_sec,
    source_lang: data.source_lang,
    target_lang: data.target_lang,
    speaker_count: speakers.size,
    segment_count: segmentCount,
    two_way: false,
    has_summary: !!data.summary,
  };
}

/** The mockup's rule: a session is named after its first translated sentence. */
export function autoTitle(data: SessionData): string {
  for (const chunk of data.chunks) {
    for (const seg of chunk.segments) {
      const text = (seg.tgt || seg.src).trim();
      if (text) return text.length > 60 ? `${text.slice(0, 60)}…` : text;
    }
  }
  return 'Empty session';
}

// ─── Export formats ────────────────────────────────────────────────────

/** Matches the desktop `_toMarkdown()` output so transcripts stay comparable. */
export function toMarkdown(data: SessionData): string {
  const lines: string[] = [];
  const title = data.title || autoTitle(data);
  const langPair = `${data.source_lang || '?'} → ${data.target_lang || '?'}`;

  lines.push(`# ${title}`, '');
  lines.push(
    `**Engine**: ${data.engine || 'unknown'} · ${langPair} · ` +
      `${formatDateTime(data.created_at)} · ${formatDuration(data.duration_sec)}`
  );
  lines.push('');

  if (data.summary) {
    const s = data.summary;
    lines.push('## Summary', '');
    if (s.tldr) lines.push(`**TL;DR** — ${s.tldr}`, '');
    if (s.keyPoints.length) {
      lines.push('**Key points**');
      s.keyPoints.forEach((p) => lines.push(`- ${p}`));
      lines.push('');
    }
    if (s.decisions.length) {
      lines.push('**Decisions**');
      s.decisions.forEach((d) => lines.push(`- ${d}`));
      lines.push('');
    }
    if (s.actions.length) {
      lines.push('**Action items**');
      s.actions.forEach((a) => lines.push(`- ${a.owner ? `${a.owner}: ` : ''}${a.text}`));
      lines.push('');
    }
    if (s.openQuestions.length) {
      lines.push('**Open questions**');
      s.openQuestions.forEach((q) => lines.push(`- ${q}`));
      lines.push('');
    }
    lines.push(`_${s.model} · generated ${formatDateTime(s.generatedAt)}_`, '');
  }

  data.chunks.forEach((chunk, i) => {
    if (i > 0) {
      const prevEnd = new Date(data.chunks[i - 1].ended_at ?? chunk.started_at).getTime();
      const curStart = new Date(chunk.started_at).getTime();
      const gapMin = Math.max(0, Math.round((curStart - prevEnd) / 60000));
      lines.push('', `──── resumed at ${timeOf(chunk.started_at)} (after ${gapMin}m) ────`, '');
    }
    const endStr = chunk.ended_at ? timeOf(chunk.ended_at) : '...';
    lines.push(`## Chunk ${i + 1} — ${timeOf(chunk.started_at)} – ${endStr}`, '');

    for (const seg of chunk.segments) {
      if (seg.src) {
        lines.push(`[${seg.ts}] ${seg.src}`);
        lines.push(`→ ${seg.tgt}`);
      } else {
        lines.push(`[${seg.ts}] ${seg.tgt}`);
      }
      lines.push('');
    }
  });

  return lines.join('\n');
}

export function toPlainText(data: SessionData): string {
  const lines: string[] = [];
  for (const chunk of data.chunks) {
    for (const seg of chunk.segments) {
      if (seg.tgt) lines.push(seg.tgt);
    }
  }
  return lines.join('\n');
}

export function toSrt(data: SessionData): string {
  const blocks: string[] = [];
  let index = 1;
  const flat = data.chunks.flatMap((c) => c.segments);

  flat.forEach((seg, i) => {
    const start = parseTs(seg.ts);
    // No end timestamp is recorded per segment, so run each cue up to the next
    // one and give the last cue a fixed 3 s tail.
    const end = i + 1 < flat.length ? parseTs(flat[i + 1].ts) : start + 3;
    blocks.push(
      String(index++),
      `${srtTime(start)} --> ${srtTime(end)}`,
      seg.tgt || seg.src,
      ''
    );
  });

  return blocks.join('\n');
}


// ─── Formatting helpers ────────────────────────────────────────────────

export function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}`;
  return `${m} min`;
}

export function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function timeOf(iso: string): string {
  return formatDateTime(iso).slice(11);
}

function parseTs(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function srtTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const ms = Math.round((totalSec % 1) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

/**
 * An export's text body. On mobile this was `writeExport`, which wrote into the
 * cache directory and handed a file:// uri to expo-sharing; the browser has no
 * cache directory, so the caller turns this into a Blob instead.
 */
export function exportBody(data: SessionData, format: 'md' | 'txt' | 'srt'): string {
  if (format === 'md') return toMarkdown(data);
  if (format === 'txt') return toPlainText(data);
  return toSrt(data);
}

export const EXPORT_MIME: Record<'md' | 'txt' | 'srt', string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  srt: 'application/x-subrip',
};
