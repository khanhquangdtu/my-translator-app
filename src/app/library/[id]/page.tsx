/**
 * Archived session — the review screen.
 *
 * Two panes behind one segmented control. **Summary** leads because it is what
 * you want an hour after the meeting; **Transcript** holds the full record,
 * oldest first, because an archive is read top to bottom where a live feed is
 * watched at a fixed point.
 */
'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ActionSheet } from '@/components/ActionSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ChevronLeftIcon, PencilIcon } from '@/components/icons';
import { AppBar, AppBarIcon, AppBarTitle, Cta, IconBtn, Seg } from '@/components/primitives';
import { PromptDialog } from '@/components/PromptDialog';
import { ActionBar, Screen, ScreenBody } from '@/components/Screen';
import {
  SummaryFailed,
  SummaryGenerating,
  SummaryIdle,
  SummaryUnavailable,
  SummaryView,
} from '@/components/SummaryView';
import { TurnView } from '@/components/Turn';
import { shortCode } from '@/data/languages';
import { hasOpenAIKey } from '@/lib/config/capabilities';
import { copyToClipboard, shareTextFile } from '@/lib/platform';
import {
  autoTitle,
  countTurns,
  EXPORT_MIME,
  exportBody,
  formatDuration,
  speakerNameIn,
  speakerOrderIn,
  type SessionData,
} from '@/lib/sessions/format';
import {
  deleteSession,
  readSession,
  subscribeSessions,
  updateSessionTitle,
} from '@/lib/sessions/store';
import { OPENAI_SUMMARY_MODEL } from '@/lib/summary/model';
import { useSummaryStore } from '@/state/summaryStore';
import { font } from '@/theme/tokens';

import styles from './detail.module.css';

type Pane = 'summary' | 'transcript';

export default function LibraryDetail() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [data, setData] = useState<SessionData | null>(null);
  const [pane, setPane] = useState<Pane>('summary');
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const summaryAvailable = hasOpenAIKey();
  const generate = useSummaryStore((s) => s.generate);
  const status = useSummaryStore((s) => (id ? (s.status[id] ?? 'idle') : 'idle'));
  const error = useSummaryStore((s) => (id ? (s.errors[id] ?? '') : ''));
  const missingKey = useSummaryStore((s) => (id ? !!s.missingKey[id] : false));

  // Re-read whenever the store changes: a summary started from the save dialog
  // may land while this screen is open, and so may a pull from the server.
  const reload = useCallback(() => {
    if (id) void readSession(id).then(setData);
  }, [id]);

  useEffect(() => {
    reload();
    return subscribeSessions(reload);
  }, [reload]);

  const segments = useMemo(() => (data ? data.chunks.flatMap((c) => c.segments) : []), [data]);

  const speakerIndex = useMemo(() => {
    const order = data ? speakerOrderIn(data) : [];
    return new Map(order.map((sid, i) => [sid, i]));
  }, [data]);

  const runSummary = useCallback(async () => {
    if (!id) return;
    await generate(id);
    reload();
  }, [generate, id, reload]);

  const exportAs = useCallback(
    async (format: 'md' | 'txt' | 'srt') => {
      if (!data) return;
      await shareTextFile(`${data.id}.${format}`, exportBody(data, format), EXPORT_MIME[format]);
    },
    [data]
  );

  if (!data) {
    return (
      <Screen>
        <AppBar>
          <AppBarIcon
            glyph={(tint) => <ChevronLeftIcon color={tint} />}
            accessibilityLabel="Back"
            onPress={() => router.back()}
          />
          <AppBarTitle muted>Loading…</AppBarTitle>
        </AppBar>
      </Screen>
    );
  }

  const meta =
    `${formatDate(data.created_at)} · ${formatDuration(data.duration_sec)}` +
    ` · ${shortCode(data.source_lang)} → ${shortCode(data.target_lang)}` +
    (speakerIndex.size > 0 ? ` · ${speakerIndex.size} speakers` : '');

  return (
    <Screen>
      <AppBar>
        <AppBarIcon
          glyph={(tint) => <ChevronLeftIcon color={tint} />}
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        {/* Same fallback as the Library list, so a session doesn't have two
            different names depending on which screen you're looking at. */}
        <AppBarTitle style={{ fontSize: 14 }}>{data.title || autoTitle(data)}</AppBarTitle>
        <AppBarIcon
          glyph={(tint) => <PencilIcon size={17} color={tint} />}
          accessibilityLabel="Rename"
          onPress={() => setRenaming(true)}
        />
        <AppBarIcon glyph="⤴" accessibilityLabel="Share" onPress={() => void exportAs('md')} />
        <AppBarIcon
          glyph="⋯"
          accessibilityLabel="Export in another format"
          onPress={() => setExporting(true)}
        />
      </AppBar>

      <Seg
        options={[
          { value: 'summary', label: '✨ Summary' },
          { value: 'transcript', label: 'Transcript' },
        ]}
        value={pane}
        onChange={setPane}
      />

      {pane === 'summary' ? (
        <ScreenBody className={styles.summaryPane}>
          {status === 'generating' ? (
            <SummaryGenerating turnCount={countTurns(data)} model={OPENAI_SUMMARY_MODEL} />
          ) : status === 'error' ? (
            missingKey ? (
              <SummaryUnavailable />
            ) : (
              <SummaryFailed message={error} onRetry={runSummary} />
            )
          ) : data.summary ? (
            <SummaryView summary={data.summary} onRegenerate={runSummary} />
          ) : summaryAvailable ? (
            <SummaryIdle onGenerate={runSummary} />
          ) : (
            <SummaryUnavailable />
          )}
        </ScreenBody>
      ) : (
        <ScreenBody className={styles.transcript}>
          <span className={styles.meta}>{meta}</span>
          {segments.map((item, i) => (
            <TurnView
              key={i}
              speakerName={speakerNameIn(data, item.speaker)}
              speakerIndex={item.speaker ? (speakerIndex.get(item.speaker) ?? 0) : 0}
              // One line per segment, not a grouped run: each carries its own
              // timestamp, and the chip is where that timestamp lives.
              lines={[
                {
                  key: `${item.ts}-${item.src}`,
                  src: item.src,
                  dst: item.tgt,
                  state: 'final',
                  showSource: true,
                },
              ]}
              fontSize={font.dstArchive}
              timestamp={item.ts}
            />
          ))}
        </ScreenBody>
      )}

      <ActionBar>
        <IconBtn
          glyph="⧉"
          accessibilityLabel="Copy all"
          onPress={() => void copyToClipboard(segments.map((s) => s.tgt || s.src).join('\n'))}
        />
        <Cta label="⤴  Share transcript" flex={1} onPress={() => void exportAs('md')} />
        <IconBtn
          glyph="🗑"
          accessibilityLabel="Delete session"
          danger
          onPress={() => setDeleting(true)}
        />
      </ActionBar>

      <ActionSheet
        visible={exporting}
        title="Export transcript"
        options={(['md', 'txt', 'srt'] as const).map((format) => ({
          label: `.${format}`,
          onSelect: () => void exportAs(format),
        }))}
        onClose={() => setExporting(false)}
      />

      <ConfirmDialog
        visible={deleting}
        title="Delete this session?"
        footnote="This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setDeleting(false);
          await deleteSession(data.id);
          router.back();
        }}
      />

      <PromptDialog
        key={data.id + (renaming ? '-open' : '')}
        visible={renaming}
        title="Rename session"
        message="Leave it blank to fall back to the first translated sentence."
        initialValue={data.title}
        placeholder="e.g. Q3 sales review"
        onCancel={() => setRenaming(false)}
        onConfirm={async (value) => {
          await updateSessionTitle(data.id, value);
          setRenaming(false);
          reload();
        }}
      />
    </Screen>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
