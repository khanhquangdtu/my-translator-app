/**
 * The AI summary pane in Library detail.
 *
 * Five fixed sections, always in this order — the order is the design, so it
 * lives here rather than in the model's discretion. Bullets carry a
 * section-specific marker: • for points, ✓ for decisions, ? for open questions.
 *
 * The three non-happy states (generating, unavailable, failed) all repeat the
 * same reassurance, because it is the thing a user actually needs to know: the
 * transcript is already saved either way.
 */
'use client';

import type { ReactNode } from 'react';

import type { Summary } from '@/lib/summary/types';
import { color } from '@/theme/tokens';

import { cx, Pill } from './primitives';
import styles from './SummaryView.module.css';

type Marker = 'bullet' | 'decision' | 'question';

export function SummaryView({
  summary,
  onRegenerate,
}: {
  summary: Summary;
  onRegenerate: () => void;
}) {
  return (
    <div>
      {summary.tldr ? (
        <Block title="TL;DR">
          <p className={styles.paragraph}>{summary.tldr}</p>
        </Block>
      ) : null}

      {summary.keyPoints.length > 0 ? (
        <Block title="Key points">
          {summary.keyPoints.map((point, i) => (
            <Bullet key={i} marker="bullet" text={point} />
          ))}
        </Block>
      ) : null}

      {summary.decisions.length > 0 ? (
        <Block title="Decisions">
          {summary.decisions.map((decision, i) => (
            <Bullet key={i} marker="decision" text={decision} />
          ))}
        </Block>
      ) : null}

      {summary.actions.length > 0 ? (
        <Block title="Action items">
          {summary.actions.map((action, i) => (
            <Bullet key={i} marker="bullet" text={action.text} owner={action.owner} />
          ))}
        </Block>
      ) : null}

      {summary.openQuestions.length > 0 ? (
        <Block title="Open questions">
          {summary.openQuestions.map((question, i) => (
            <Bullet key={i} marker="question" text={question} />
          ))}
        </Block>
      ) : null}

      <div className={styles.foot}>
        <span className={styles.footText}>✨</span>
        <span className={styles.footText}>
          {summary.model} · generated {timeOf(summary.generatedAt)}
        </span>
        <button type="button" onClick={onRegenerate} className={styles.regenerate}>
          ↻ Regenerate
        </button>
      </div>
    </div>
  );
}

/** Shown while the request is in flight. */
export function SummaryGenerating({ turnCount, model }: { turnCount: number; model: string }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.pulseDot} />
        <span className={styles.cardTitle}>Summarizing…</span>
      </div>
      <span className={styles.cardBody}>
        Sending {turnCount} turns to {model}. Usually takes a few seconds; the transcript is already
        saved.
      </span>
    </div>
  );
}

/**
 * Shown when summaries aren't available on this deployment. Never framed as an
 * error and never as something the user can fix by typing — there is no key
 * field, so the honest message is that the transcript is safe regardless.
 */
export function SummaryUnavailable() {
  return (
    <div className={cx(styles.card, styles.cardDashed)}>
      <span className={styles.cardTitle}>Summary unavailable</span>
      <span className={styles.cardBody}>
        This build has no summary feature enabled. The transcript is still saved in full.
      </span>
    </div>
  );
}

export function SummaryFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={cx(styles.card, styles.cardError)}>
      <span className={cx(styles.cardTitle, styles.cardTitleError)}>Summary failed</span>
      <span className={cx(styles.cardBody, styles.cardBodySpaced)}>{message} Nothing was lost.</span>
      <div className={styles.cardAction}>
        <Pill onPress={onRetry}>↻ Try again</Pill>
      </div>
    </div>
  );
}

/** Session saved, no summary requested yet. */
export function SummaryIdle({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className={styles.card}>
      <span className={styles.cardTitle}>No summary yet</span>
      <span className={cx(styles.cardBody, styles.cardBodySpaced)}>
        Create a summary of the key points, decisions, and action items from the whole conversation.
      </span>
      <div className={styles.cardAction}>
        <Pill onPress={onGenerate}>
          <span style={{ color: color.accent }}>✨ Summarize conversation</span>
        </Pill>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.block}>
      <h2 className={styles.blockTitle}>{title.toUpperCase()}</h2>
      <div className={styles.list}>{children}</div>
    </section>
  );
}

const MARKERS: Record<Marker, { glyph: string; color: string }> = {
  bullet: { glyph: '•', color: color.accent },
  decision: { glyph: '✓', color: color.success },
  question: { glyph: '?', color: color.warning },
};

function Bullet({
  marker,
  text,
  owner,
}: {
  marker: Marker;
  text: string;
  owner?: string | null;
}) {
  const { glyph, color: markerColor } = MARKERS[marker];
  return (
    <div className={styles.item}>
      <span className={styles.marker} style={{ color: markerColor }}>
        {glyph}
      </span>
      <span className={styles.itemText}>
        {owner ? <span className={styles.owner}>{owner} </span> : null}
        {text}
      </span>
    </div>
  );
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
