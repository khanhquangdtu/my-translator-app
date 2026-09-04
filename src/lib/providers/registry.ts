/**
 * The providers this deployment holds credentials for.
 *
 * One list, imported by both halves: the admin UI renders a card per entry, and
 * the server resolves keys by the same ids. Adding a provider later means
 * adding a row here — the admin page, the key store and the status endpoint all
 * pick it up without further edits, which is the whole reason this is data
 * rather than four hand-written screens.
 *
 * Deliberately free of anything server-only: this module reaches the browser,
 * so it carries names and shapes, never values.
 */

export type ProviderId = 'soniox' | 'openai';

/** How the admin page can report what a provider has spent. */
export type UsageSource =
  /** The provider itself answers with cost and volume — ask it directly. */
  | 'provider-api'
  /** No such API exists, so the app records what it spends as it spends it. */
  | 'self-tracked'
  /** Nothing is known. Reserved for providers added before their usage story. */
  | 'none';

export type ProviderSpec = {
  id: ProviderId;
  label: string;
  /**
   * The environment variable this key was read from before the admin page
   * existed. Still the fallback, and still how a fresh deployment boots with no
   * database rows at all.
   */
  envVar: string;
  /** What breaks when this key is missing — shown under the card's title. */
  purpose: string;
  /** Shape check before saving. Catches a pasted placeholder or a truncated key. */
  keyPattern: RegExp;
  keyHint: string;
  usageSource: UsageSource;
};

export const PROVIDERS: ProviderSpec[] = [
  {
    id: 'soniox',
    label: 'Soniox',
    envVar: 'SONIOX_API_KEY',
    purpose: 'Live speech-to-text. Without it a session cannot start at all.',
    // Soniox does not publish a key format, so this only rejects the obviously
    // wrong: whitespace, and anything too short to be a credential.
    keyPattern: /^\S{20,}$/,
    keyHint: 'A Soniox API key, at least 20 characters.',
    usageSource: 'provider-api',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    purpose: 'Meeting summaries and speaker names. Optional — transcripts save without it.',
    keyPattern: /^sk-\S{20,}$/,
    keyHint: 'Starts with "sk-".',
    // OpenAI exposes neither a balance nor, to a project key, a spend endpoint:
    // /v1/organization/costs answers 403 without the api.usage.read scope that
    // only an admin key carries. So the app counts its own consumption from the
    // `usage` block every completion already returns.
    usageSource: 'self-tracked',
  },
];

export function providerSpec(id: string): ProviderSpec | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * Last four characters, the rest replaced.
 *
 * The admin page has to show *something* per key or there is no way to tell a
 * stale key from a current one, and the tail is enough to compare against a
 * provider dashboard without being enough to use.
 */
export function maskKey(key: string): string {
  const tail = key.slice(-4);
  return `${'•'.repeat(8)}${tail}`;
}
