/**
 * The operator's screen: which provider keys are live, and what they have cost.
 *
 * Everything here is behind a password, because everything here is either a
 * credential or a bill. The page holds no secret of its own — keys arrive
 * masked and leave only on their way to being verified and stored, so what is
 * in the browser at any moment is the last four characters and nothing more.
 *
 * The provider cards are generated from `PROVIDERS`, not hand-written, so
 * adding a third provider is a row in that list rather than an edit here.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ChevronLeftIcon } from '@/components/icons';
import {
  AppBar,
  AppBarIcon,
  AppBarTitle,
  Banner,
  Cta,
  cx,
  Field,
  Seg,
  SectionLabel,
} from '@/components/primitives';
import { Screen, ScreenBody } from '@/components/Screen';
import { PROVIDERS, type ProviderId } from '@/lib/providers/registry';

import styles from './admin.module.css';

type KeyOrigin = 'database' | 'environment' | 'missing';

type ProviderStatus = {
  id: ProviderId;
  origin: KeyOrigin;
  masked: string | null;
  updatedAt: string | null;
};

type UsageSeries = {
  provider: ProviderId;
  source: 'provider-api' | 'self-tracked' | 'none';
  totalCostUsd: number | null;
  totalRequests: number;
  totalTokens: number | null;
  audioSeconds: number | null;
  days: { day: string; costUsd: number | null; requests: number; tokens: number | null }[];
  models: { model: string; costUsd: number | null; requests: number; tokens: number | null }[];
  error: string | null;
};

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

export default function AdminPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<'checking' | 'locked' | 'open'>('checking');
  const [configProblem, setConfigProblem] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/admin/session');
        const body = (await response.json()) as {
          configured: boolean;
          problem: string | null;
          signedIn: boolean;
        };
        setConfigProblem(body.configured ? null : body.problem);
        setPhase(body.signedIn ? 'open' : 'locked');
      } catch {
        // Offline, or the server is down. "Locked" is the honest state: we
        // cannot show anything, and the login form will report the real error
        // as soon as it is submitted.
        setPhase('locked');
      }
    })();
  }, []);

  return (
    <Screen>
      <AppBar>
        <AppBarIcon
          glyph={(tint) => <ChevronLeftIcon color={tint} />}
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <AppBarTitle>Admin</AppBarTitle>
      </AppBar>

      <ScreenBody className={styles.body}>
        {phase === 'checking' ? null : phase === 'locked' ? (
          <LoginForm problem={configProblem} onSignedIn={() => setPhase('open')} />
        ) : (
          <Console onSignedOut={() => setPhase('locked')} />
        )}
      </ScreenBody>
    </Screen>
  );
}

// ─── login ─────────────────────────────────────────────────────────────

function LoginForm({ problem, onSignedIn }: { problem: string | null; onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        setPassword('');
        onSignedIn();
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Sign-in failed (${response.status}).`);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [password, busy, onSignedIn]);

  if (problem) {
    return (
      <div className={styles.login}>
        <Banner tone="warn" glyph="⚙" text={`The admin area is disabled. ${problem}`} />
      </div>
    );
  }

  return (
    <div className={styles.login}>
      <p className={styles.loginBlurb}>
        This area manages the provider API keys this deployment runs on.
      </p>
      <Field
        value={password}
        onChangeText={setPassword}
        placeholder="Admin password"
        secure
        autoFocus
        onSubmit={submit}
      />
      {error ? <Banner tone="error" glyph="⚠" text={error} /> : null}
      <Cta label={busy ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={!password || busy} />
    </div>
  );
}

// ─── signed in ─────────────────────────────────────────────────────────

function Console({ onSignedOut }: { onSignedOut: () => void }) {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [writable, setWritable] = useState(true);
  const [writeBlocker, setWriteBlocker] = useState<string | null>(null);
  const [days, setDays] = useState('30');
  const [usage, setUsage] = useState<UsageSeries[] | null>(null);
  const [usageBusy, setUsageBusy] = useState(true);

  const loadKeys = useCallback(async () => {
    const response = await fetch('/api/admin/keys');
    if (response.status === 401) {
      onSignedOut();
      return;
    }
    const body = (await response.json()) as {
      providers: ProviderStatus[];
      writable: boolean;
      reason: string | null;
    };
    setProviders(body.providers);
    setWritable(body.writable);
    setWriteBlocker(body.reason);
  }, [onSignedOut]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    let cancelled = false;
    setUsageBusy(true);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/usage?days=${days}`);
        if (response.status === 401) {
          onSignedOut();
          return;
        }
        const body = (await response.json()) as { providers: UsageSeries[] };
        if (!cancelled) setUsage(body.providers);
      } catch {
        if (!cancelled) setUsage(null);
      } finally {
        if (!cancelled) setUsageBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days, onSignedOut]);

  const signOut = useCallback(async () => {
    await fetch('/api/admin/session', { method: 'DELETE' });
    onSignedOut();
  }, [onSignedOut]);

  return (
    <>
      <SectionLabel>Provider keys</SectionLabel>
      {writeBlocker ? <Banner tone="warn" glyph="⚙" text={writeBlocker} /> : null}
      {providers?.map((status) => (
        <KeyCard key={status.id} status={status} writable={writable} onChanged={loadKeys} />
      ))}

      <SectionLabel>Usage</SectionLabel>
      <div className={styles.windowRow}>
        <Seg options={WINDOWS} value={days} onChange={setDays} />
      </div>
      {/* Soniox is a network call away, so this gap is measured in seconds on a
          cold load. Rendering nothing would read as "no usage", which is a
          different and wrong answer. */}
      {usageBusy && !usage ? (
        <p className={styles.loading}>Loading usage…</p>
      ) : usage ? (
        usage.map((series) => <UsageCard key={series.provider} series={series} />)
      ) : (
        <p className={styles.note}>Could not load usage.</p>
      )}
      <p className={styles.note}>
        These are amounts spent, not balances. Neither provider publishes a remaining credit
        figure: Soniox has no balance endpoint, and OpenAI’s cost API rejects project keys.
        Check the provider dashboards for what is left on the account.
      </p>

      <SectionLabel>Session</SectionLabel>
      <div className={styles.card}>
        <div className={styles.editorActions}>
          <Cta label="Sign out" variant="ghost" onPress={signOut} flex={1} />
        </div>
      </div>
    </>
  );
}

// ─── one provider's key ────────────────────────────────────────────────

const ORIGIN_LABEL: Record<KeyOrigin, string> = {
  database: 'Set here',
  environment: 'From .env',
  missing: 'Not set',
};

function KeyCard({
  status,
  writable,
  onChanged,
}: {
  status: ProviderStatus;
  writable: boolean;
  onChanged: () => Promise<void>;
}) {
  const spec = PROVIDERS.find((p) => p.id === status.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: status.id, key: draft.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Could not save (${response.status}).`);
        return;
      }
      setDraft('');
      setEditing(false);
      await onChanged();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [draft, busy, status.id, onChanged]);

  const revert = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/admin/keys?provider=${status.id}`, { method: 'DELETE' });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }, [status.id, onChanged]);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{spec?.label ?? status.id}</span>
        <span
          className={cx(
            styles.origin,
            status.origin === 'database' && styles.originDatabase,
            status.origin === 'missing' && styles.originMissing
          )}>
          {ORIGIN_LABEL[status.origin]}
        </span>
      </div>
      <p className={styles.cardPurpose}>{spec?.purpose}</p>

      <div className={styles.keyLine}>
        {status.masked ? (
          <span className={styles.masked}>{status.masked}</span>
        ) : (
          <span className={styles.notSet}>No key configured</span>
        )}
      </div>

      {status.updatedAt ? (
        <p className={styles.stamp}>Updated {new Date(status.updatedAt).toLocaleString()}</p>
      ) : null}

      {editing ? (
        <div className={styles.editor}>
          <Field
            value={draft}
            onChangeText={setDraft}
            placeholder={spec?.keyHint ?? 'Paste the key'}
            secure
            monospace
            autoFocus
            onSubmit={save}
          />
          {error ? <Banner tone="error" glyph="⚠" text={error} /> : null}
          <div className={styles.editorActions}>
            {/* The label says what the button actually does: it calls the
                provider before it stores anything, so a wrong key is refused
                here rather than at the next Start. */}
            <Cta
              label={busy ? 'Verifying…' : 'Verify and save'}
              onPress={save}
              disabled={!draft.trim() || busy}
              flex={1}
            />
            <Cta
              label="Cancel"
              variant="ghost"
              onPress={() => {
                setEditing(false);
                setDraft('');
                setError(null);
              }}
            />
          </div>
        </div>
      ) : (
        <div className={styles.editor}>
          <div className={styles.editorActions}>
            <Cta
              label={status.masked ? 'Replace key' : 'Add key'}
              variant="ghost"
              onPress={() => setEditing(true)}
              disabled={!writable}
              flex={1}
            />
            {status.origin === 'database' ? (
              <Cta label="Use .env" variant="ghost" onPress={revert} disabled={busy} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── one provider's spend ──────────────────────────────────────────────

function formatUsd(value: number): string {
  // Four decimals below a cent: a day of light use costs fractions of a cent,
  // and rounding those to $0.00 would make the chart look broken.
  return value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function UsageCard({ series }: { series: UsageSeries }) {
  const spec = PROVIDERS.find((p) => p.id === series.provider);

  // Cost where the provider reports money, tokens where it does not. Both are
  // real measurements; only one of them is billable, and the unit says which.
  const usesCost = series.totalCostUsd !== null;
  const values = series.days.map((d) => (usesCost ? (d.costUsd ?? 0) : (d.tokens ?? 0)));
  const peak = Math.max(1, ...values);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{spec?.label ?? series.provider}</span>
        <span className={styles.origin}>
          {series.source === 'provider-api' ? 'From provider' : 'Counted here'}
        </span>
      </div>

      {series.error ? (
        <p className={styles.empty}>{series.error}</p>
      ) : series.totalRequests === 0 ? (
        <p className={styles.empty}>Nothing used in this window.</p>
      ) : (
        <>
          <div className={styles.headline}>
            <span className={styles.headlineValue}>
              {usesCost ? formatUsd(series.totalCostUsd ?? 0) : formatCount(series.totalTokens ?? 0)}
            </span>
            <span className={styles.headlineUnit}>{usesCost ? 'spent' : 'tokens'}</span>
          </div>

          <div className={styles.stats}>
            <span className={styles.stat}>
              <span className={styles.statValue}>{formatCount(series.totalRequests)}</span> requests
            </span>
            {series.audioSeconds ? (
              <span className={styles.stat}>
                <span className={styles.statValue}>
                  {(series.audioSeconds / 3600).toFixed(1)}
                </span>{' '}
                hours of audio
              </span>
            ) : null}
            {usesCost && series.totalTokens ? (
              <span className={styles.stat}>
                <span className={styles.statValue}>{formatCount(series.totalTokens)}</span> tokens
              </span>
            ) : null}
          </div>

          {series.days.length > 1 ? (
            <>
              <div className={styles.chart}>
                {series.days.map((day, i) => {
                  const value = values[i];
                  return (
                    <div
                      key={day.day}
                      className={cx(styles.bar, value === 0 && styles.barEmpty)}
                      style={{ height: `${Math.max(2, (value / peak) * 100)}%` }}
                      title={`${day.day} · ${usesCost ? formatUsd(value) : `${formatCount(value)} tokens`}`}
                    />
                  );
                })}
              </div>
              <div className={styles.chartRange}>
                <span>{series.days[0]?.day}</span>
                <span>{series.days[series.days.length - 1]?.day}</span>
              </div>
            </>
          ) : null}

          {series.models.length > 0 ? (
            <div className={styles.models}>
              {series.models.map((model) => (
                <div key={model.model} className={styles.modelRow}>
                  <span className={styles.modelName}>{model.model}</span>
                  <span className={styles.modelValue}>
                    {model.costUsd !== null
                      ? formatUsd(model.costUsd)
                      : `${formatCount(model.tokens ?? 0)} tok`}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
