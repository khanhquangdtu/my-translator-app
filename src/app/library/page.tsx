/**
 * Library — session history, grouped by day, newest first.
 *
 * Titles default to the first translated sentence and are editable. Each row
 * carries its language pair and speaker count so a session is identifiable
 * without opening it.
 *
 * Where mobile called `useFocusEffect(refresh)`, this subscribes to the store:
 * a background pull from the server can land at any moment, and the list has to
 * notice it without the user leaving and coming back.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ActionSheet } from '@/components/ActionSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ChevronLeftIcon, PencilIcon, SearchIcon } from '@/components/icons';
import { AppBar, AppBarIcon, AppBarTitle, Field } from '@/components/primitives';
import { PromptDialog } from '@/components/PromptDialog';
import { Screen, ScreenBody } from '@/components/Screen';
import { SwipeRow } from '@/components/SwipeRow';
import { shortCode } from '@/data/languages';
import { useLongPress } from '@/hooks/useLongPress';
import { shareTextFile } from '@/lib/platform';
import {
  EXPORT_MIME,
  exportBody,
  formatDuration,
  type SessionSummary,
} from '@/lib/sessions/format';
import {
  deleteSession,
  listSessions,
  readSession,
  subscribeSessions,
  updateSessionTitle,
} from '@/lib/sessions/store';
import { color } from '@/theme/tokens';

import styles from './library.module.css';

type Row = { type: 'day'; label: string } | { type: 'session'; item: SessionSummary };

export default function LibraryList() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  const [menuFor, setMenuFor] = useState<SessionSummary | null>(null);
  /** At most one row shows its delete panel; the list, not the row, decides. */
  const [swipedId, setSwipedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listSessions().then(setSessions);
  }, []);

  useEffect(() => {
    refresh();
    return subscribeSessions(refresh);
  }, [refresh]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;

    const out: Row[] = [];
    let lastLabel: string | null = null;
    for (const item of filtered) {
      const label = dayLabel(item.created_at);
      if (label !== lastLabel) {
        out.push({ type: 'day', label });
        lastLabel = label;
      }
      out.push({ type: 'session', item });
    }
    return out;
  }, [sessions, query]);

  const share = useCallback(async (item: SessionSummary) => {
    const data = await readSession(item.id);
    if (!data) return;
    await shareTextFile(`${data.id}.md`, exportBody(data, 'md'), EXPORT_MIME.md);
  }, []);

  const confirmDelete = useCallback(async () => {
    const target = deleting;
    setDeleting(null);
    setSwipedId(null);
    if (target) await deleteSession(target.id);
    refresh();
  }, [deleting, refresh]);

  return (
    <Screen>
      <AppBar>
        <AppBarIcon
          glyph={(tint) => <ChevronLeftIcon color={tint} />}
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <AppBarTitle>Library</AppBarTitle>
        <AppBarIcon
          glyph={(tint) => <SearchIcon color={tint} />}
          accessibilityLabel="Search"
          active={searching}
          onPress={() => {
            setSearching((s) => !s);
            setQuery('');
          }}
        />
      </AppBar>

      {searching ? (
        <div className={styles.search}>
          <Field value={query} onChangeText={setQuery} placeholder="Search sessions" autoFocus />
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyText}>
            {query ? 'No sessions match that search.' : 'No saved sessions yet.'}
          </span>
        </div>
      ) : (
        <ScreenBody
          className={styles.list}
          // Scrolling is the clearest "I'm done with that row" signal there is.
          onScroll={swipedId ? () => setSwipedId(null) : undefined}>
          {rows.map((row) =>
            row.type === 'day' ? (
              <div key={`d${row.label}`} className={styles.dayLabel}>
                {row.label.toUpperCase()}
              </div>
            ) : (
              <SessionRow
                key={row.item.id}
                item={row.item}
                open={swipedId === row.item.id}
                onOpenChange={(open) => setSwipedId(open ? row.item.id : null)}
                onOpen={() => {
                  // A tap on an open row dismisses the panel instead of
                  // navigating — otherwise the row is left armed behind you.
                  if (swipedId === row.item.id) setSwipedId(null);
                  else router.push(`/library/${row.item.id}`);
                }}
                onMenu={() => setMenuFor(row.item)}
                onRename={() => setRenaming(row.item)}
                onDelete={() => setDeleting(row.item)}
              />
            )
          )}
        </ScreenBody>
      )}

      {/* The mobile build's long-press Alert, as a bottom sheet. */}
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.title}
        options={
          menuFor
            ? [
                { label: 'Rename', glyph: '✎', onSelect: () => setRenaming(menuFor) },
                { label: 'Share', glyph: '⤴', onSelect: () => void share(menuFor) },
                // Same confirmation as the swipe path — a delete is a delete
                // however the user reached it.
                { label: 'Delete', glyph: '🗑', danger: true, onSelect: () => setDeleting(menuFor) },
              ]
            : []
        }
        onClose={() => setMenuFor(null)}
      />

      <PromptDialog
        key={renaming?.id ?? 'none'}
        visible={renaming !== null}
        title="Rename session"
        message="Leave it blank to fall back to the first translated sentence."
        initialValue={renaming?.title ?? ''}
        placeholder="e.g. Q3 sales review"
        onCancel={() => setRenaming(null)}
        onConfirm={async (value) => {
          if (renaming) await updateSessionTitle(renaming.id, value);
          setRenaming(null);
          refresh();
        }}
      />
      <ConfirmDialog
        visible={deleting !== null}
        title="Delete this session?"
        message={
          deleting
            ? `“${deleting.title}” will be removed — transcript and summary alike.`
            : undefined
        }
        footnote="This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => {
          setDeleting(null);
          setSwipedId(null);
        }}
        onConfirm={confirmDelete}
      />
    </Screen>
  );
}

function SessionRow({
  item,
  open,
  onOpenChange,
  onOpen,
  onMenu,
  onRename,
  onDelete,
}: {
  item: SessionSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: () => void;
  onMenu: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const longPress = useLongPress(onMenu);

  return (
    <SwipeRow
      open={open}
      onOpenChange={onOpenChange}
      onAction={onDelete}
      actionLabel={`Delete ${item.title}`}>
      <div
        role="button"
        tabIndex={0}
        className={styles.row}
        {...longPress.handlers}
        onClick={() => {
          // The long press already opened the menu; the click that follows it
          // must not also navigate.
          if (longPress.didLongPress()) return;
          onOpen();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen();
          }
        }}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{item.title}</span>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Rename ${item.title}`}
            className={styles.pencil}
            onClick={(event) => {
              event.stopPropagation();
              onRename();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              onRename();
            }}>
            <PencilIcon color={color.textSecondary} />
          </span>
        </div>
        <div className={styles.meta}>
          <span className={styles.metaDot} />
          <span className={styles.metaText}>
            {`${shortCode(item.source_lang)} → ${shortCode(item.target_lang)}`}
            {` · ${formatDuration(item.duration_sec)}`}
            {item.speaker_count > 0 ? ` · ${item.speaker_count} speakers` : ''}
            {` · ${relativeTime(item.created_at)}`}
          </span>
        </div>
      </div>
    </SwipeRow>
  );
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (same(date, today)) return 'Today';
  if (same(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

function relativeTime(iso: string): string {
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
