/**
 * The shape of a conversation summary.
 *
 * Five sections, always in this order — the order is part of the design, not an
 * accident of the model's output, so it is fixed here rather than left to the
 * prompt. Action items carry an owner, which is where speaker diarization pays
 * off a second time: "Kenji — send revised budget by Friday" is worth far more
 * than an unattributed bullet.
 */

export type ActionItem = {
  /** speaker display name at generation time, or null if unattributed */
  owner: string | null;
  text: string;
};

export type Summary = {
  tldr: string;
  keyPoints: string[];
  decisions: string[];
  actions: ActionItem[];
  openQuestions: string[];
  /** which model produced it, for the footer line */
  model: string;
  provider: SummaryProvider;
  /** ISO timestamp */
  generatedAt: string;
};

export type SummaryProvider = 'openai' | 'anthropic' | 'google';

export type SummaryStatus = 'idle' | 'generating' | 'error';

/** Raised so callers can tell "no key" apart from a provider failure. */
export class MissingKeyError extends Error {
  constructor() {
    super('No API key for the summary feature');
    this.name = 'MissingKeyError';
  }
}
