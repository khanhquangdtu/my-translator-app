/**
 * Live — the whole app.
 *
 * There is no tab bar: Live is the root screen and every other destination is a
 * full-screen push from the app bar or the ⋯ sheet, which is what keeps the
 * 62pt a tab bar would have eaten for the transcript. And there is no split
 * pane: one stream, newest turn at the top, translation over source, so the
 * newest line lands in the same place every time and the eye never has to hunt
 * for it.
 *
 * Four states share this screen — Idle, Listening, Degraded, and (in landscape)
 * Table mode.
 *
 * Ported from the Expo screen. The only substantive rewrite is the list: a
 * `FlatList` with `maintainVisibleContentPosition` becomes a plain scroller
 * plus the scroll compensation below, because nothing in the browser does that
 * job reliably on its own.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { AlertDialog } from '@/components/AlertDialog';
import { HomeIcon, LibraryIcon, SettingsIcon } from '@/components/icons';
import { InstallButton } from '@/components/InstallButton';
import { IdleWave, LevelMeter } from '@/components/meter';
import {
  AppBar,
  AppBarIcon,
  AppBarTitle,
  Banner,
  Cta,
  cx,
  IconBtn,
  Pill,
  StatusDot,
  type DotTone,
} from '@/components/primitives';
import { PromptDialog } from '@/components/PromptDialog';
import { SaveDialog } from '@/components/SaveDialog';
import { ActionBar, Screen } from '@/components/Screen';
import { Sheet, SheetGroup, SheetItem, SheetNote, SheetSeparator } from '@/components/Sheet';
import { TwoWayPanels, type TwoWayPanelData } from '@/components/TwoWayPanels';
import { NewestDivider, TurnView, type TurnLine, type TurnState } from '@/components/Turn';
import { shortCode } from '@/data/languages';
import type { Segment } from '@/lib/sessions/format';
import { useWindowSize } from '@/hooks/useWindowSize';
import { hasOpenAIKey } from '@/lib/config/capabilities';
import { MOCK_ENABLED } from '@/lib/engine/mock';
import { readSegmentRange } from '@/lib/sessions/history';
import { nextPage, splitWindow } from '@/lib/sessions/window';
import { copyToClipboard, lockLandscape, unlockOrientation } from '@/lib/platform';
import { estimateCost, speakerDisplayName, useLive, type Turn } from '@/state/liveStore';
import { resolveLanguage, useSettings } from '@/state/settingsStore';
import { generateInBackground } from '@/state/summaryStore';
import { useSession } from '@/state/useSession';
import { MAX_TRANSCRIPT_SIZE, MIN_TRANSCRIPT_SIZE } from '@/theme/tokens';

import styles from './live.module.css';

/** How long the mic must stay quiet before we suggest moving the phone. */
const QUIET_GRACE_SEC = 8;
/** Table mode hides its chrome this long after the last tap. */
const CHROME_TIMEOUT_SEC = 3;
/** …and dims entirely after this long without interaction. */
const DIM_TIMEOUT_SEC = 60;

/**
 * A pause longer than this ends the run. Soniox emits one turn per recognised
 * utterance, so a speaker holding the floor produces a stream of them seconds
 * apart — those are one thought and belong in one block. Coming back after a
 * long silence is a new thought even if nobody spoke in between, so it starts a
 * fresh block rather than extending the last one indefinitely.
 */
const RUN_GAP_MS = 30_000;
/** Shorter gap for two-way panels — tighter blocks keep columns readable. */
const TWO_WAY_GAP_MS = 5_000;

/** Slack for "the reader is still pinned to the newest line". */
const FOLLOW_SLACK_PX = 24;

/** Lines added per press of "View more". */
const PAGE_SIZE = 100;

/**
 * Renders a saved segment as a turn.
 *
 * Ids go negative so they cannot collide with live ones, and `createdAt` is
 * zero because the record does not keep wall-clock times — only the "MM:SS"
 * stamp that is displayed. The consequence is deliberate: history groups by
 * speaker alone, since the silence-gap rule has nothing to measure, and the
 * step up to a real timestamp guarantees a block break where history meets the
 * live window, which is where one belongs anyway.
 */
function historyTurn(segment: Segment, index: number, speakerOrder: string[]): Turn {
  return {
    id: -(index + 1),
    speaker: segment.speaker ?? null,
    // Same lookup the live turns got, so a speaker keeps one rail colour all
    // the way down the transcript.
    speakerIndex: segment.speaker ? Math.max(0, speakerOrder.indexOf(segment.speaker)) : 0,
    language: null,
    src: segment.src,
    dst: segment.tgt,
    pending: false,
    createdAt: 0,
    ts: segment.ts,
  };
}

type StartAlert = { title: string; message: string } | null;

/**
 * One block per run of consecutive same-speaker turns, newest first — inside a
 * block too, so the newest caption is always the topmost line on screen.
 */
type ListItem = {
  speaker: string | null;
  speakerIndex: number;
  /** the in-flight line, when it belongs to this run */
  provisional: string | null;
  /** its translation, as Soniox revises it — the primary text when present */
  provisionalDst: string | null;
  turns: { turn: Turn; state: TurnState }[];
};

export default function LiveScreen() {
  const router = useRouter();
  const { landscape } = useWindowSize();

  const prefs = useSettings((s) => s.prefs);
  const setPref = useSettings((s) => s.set);
  const merge = useSettings((s) => s.merge);
  const summaryAvailable = hasOpenAIKey();

  const running = useLive((s) => s.running);
  const status = useLive((s) => s.status);
  const turns = useLive((s) => s.turns);
  const droppedSegments = useLive((s) => s.droppedSegments);
  const sessionId = useLive((s) => s.sessionId);
  const provisional = useLive((s) => s.provisional);
  const provisionalDst = useLive((s) => s.provisionalDst);
  const provisionalDstLang = useLive((s) => s.provisionalDstLang);
  const error = useLive((s) => s.error);
  const reconnectAttempt = useLive((s) => s.reconnectAttempt);
  const reconnectMax = useLive((s) => s.reconnectMax);
  const elapsedSec = useLive((s) => s.elapsedSec);
  const lastLoudAtSec = useLive((s) => s.lastLoudAtSec);
  const speakerNames = useLive((s) => s.speakerNames);
  const speakerOrder = useLive((s) => s.speakerOrder);
  const turnCounts = useLive((s) => s.turnCounts);
  const renameSpeaker = useLive((s) => s.renameSpeaker);
  const suggestedNames = useLive((s) => s.suggestedNames);
  const acceptSuggestion = useLive((s) => s.acceptSuggestion);
  const dismissSuggestion = useLive((s) => s.dismissSuggestion);

  const session = useSession();

  const [panelRotation, setPanelRotation] = useState(0);
  const [panelSwap, setPanelSwap] = useState([false, false]);
  const [panelsReversed, setPanelsReversed] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [speakersOpen, setSpeakersOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [askingToSave, setAskingToSave] = useState(false);
  const [startAlert, setStartAlert] = useState<StartAlert>(null);
  /**
   * Turn ids whose original line is folded out. Live leads with the translation
   * alone — that is the whole point of the screen — but a reader who doubts a
   * line wants the source for *that* line, not a mode switch that re-flows every
   * other one.
   *
   * Several may stay open at once. Closing one to open the next would fight the
   * comparison the tap was asking for, and unlike the Library's swipe panel
   * there is nothing destructive here to keep exclusive.
   *
   * `nextTurnId` in the store is a module counter that never rewinds, so an id
   * left in here can never be re-issued to a later turn; the set is cleared on
   * start anyway so it doesn't carry between sessions.
   */
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<number>>(() => new Set<number>());
  const lastInteractionSec = useLive((s) => s.lastInteractionSec);
  const noteInteraction = useLive((s) => s.noteInteraction);

  const listRef = useRef<HTMLDivElement>(null);
  /** Scroll height at the last commit, for the prepend compensation below. */
  const lastHeight = useRef(0);
  /** whether the previous run of the scroll effect was in following mode */
  const wasFollowing = useRef(true);
  /** "Following" = pinned to the newest line. */
  const [following, setFollowing] = useState(true);

  // Both the quiet warning and the table-mode chrome are DERIVED from the
  // once-a-second session tick rather than held in effect-driven state. That
  // keeps them honest (no stale flags after a stop/start) and avoids the
  // cascading re-renders a setState-inside-an-effect would cause.
  const quiet = running && elapsedSec - lastLoudAtSec > QUIET_GRACE_SEC;

  const sinceTap = elapsedSec - lastInteractionSec;
  const chromeVisible =
    !landscape || !running || !prefs.autoHideControls || sinceTap < CHROME_TIMEOUT_SEC;
  const dimmed = landscape && running && prefs.dimInTableMode && sinceTap >= DIM_TIMEOUT_SEC;

  const wakeChrome = noteInteraction;

  // Rotating into table mode counts as an interaction, so the chrome starts
  // visible and then fades — rather than appearing pre-hidden and dimmed
  // because the session clock has been running for a while.
  useEffect(() => {
    if (landscape) noteInteraction();
  }, [landscape, noteInteraction]);

  /*
   * "View more" pages backwards past the live window.
   *
   * `shown` counts lines, not sources: the first pages come out of `turns`,
   * which holds more than the screen renders, and only past that does the
   * autosaved record get read. Keeping one number for both means the button
   * behaves the same either side of that boundary, and the reader never learns
   * where it is.
   */
  const [shown, setShown] = useState(prefs.maxLinesKept);
  const [history, setHistory] = useState<Segment[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // A new session starts at the top again; anything loaded belonged to the old one.
  useEffect(() => {
    setShown(prefs.maxLinesKept);
    setHistory([]);
  }, [sessionId, prefs.maxLinesKept]);

  const { fromMemory, fromHistory, remaining } = splitWindow(shown, turns.length, droppedSegments);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    const { want, need, start, end } = nextPage(shown, PAGE_SIZE, turns.length, droppedSegments);

    if (need > history.length && sessionId) {
      setLoadingMore(true);
      try {
        // Autosave is on a timer; the lines being asked for may be newer than
        // its last run. Flushing first is what makes the offsets line up.
        await session.persist();
        setHistory(await readSegmentRange(sessionId, start, end));
      } finally {
        setLoadingMore(false);
      }
    }
    setShown(want);
  }, [droppedSegments, history.length, loadingMore, session, sessionId, shown, turns.length]);

  // ── list data: newest first ────────────────────────────────────────
  const items = useMemo<ListItem[]>(() => {
    const older =
      fromHistory > 0
        ? history.slice(-fromHistory).map((seg, i) => historyTurn(seg, i, speakerOrder))
        : [];
    const visible = [...older, ...turns.slice(-fromMemory)];
    const list: ListItem[] = [];
    let run: ListItem | null = null;

    for (let i = visible.length - 1; i >= 0; i--) {
      const turn = visible[i];
      // Only the two most recent finalised turns keep full brightness; older
      // ones fade back so the eye lands on what just arrived.
      const distance = visible.length - 1 - i;
      const state: TurnState = distance < 2 ? 'final' : 'old';

      // `run` holds turns newest-first, so its last entry is the one this turn
      // immediately precedes — that is the gap to measure. An unattributed turn
      // (`speaker: null`) never joins a run: with no identity there is nothing
      // to say it came from the same mouth.
      const previous = run?.turns[run.turns.length - 1]?.turn;
      const continues =
        run !== null &&
        turn.speaker !== null &&
        run.speaker === turn.speaker &&
        previous !== undefined &&
        previous.createdAt - turn.createdAt <= RUN_GAP_MS;

      if (continues && run) {
        run.turns.push({ turn, state });
      } else {
        run = {
          speaker: turn.speaker,
          speakerIndex: turn.speakerIndex,
          provisional: null,
          provisionalDst: null,
          turns: [{ turn, state }],
        };
        list.push(run);
      }
    }

    // The in-flight line rides on top of the newest block when it is the same
    // speaker still talking — otherwise it would show its own chip a second
    // before merging into the block below it.
    if (provisional?.text) {
      const head = list[0];
      if (head && provisional.speaker !== null && head.speaker === provisional.speaker) {
        head.provisional = provisional.text;
        head.provisionalDst = provisionalDst;
      } else {
        list.unshift({
          speaker: provisional.speaker,
          speakerIndex: provisional.speakerIndex,
          provisional: provisional.text,
          provisionalDst,
          turns: [],
        });
      }
    } else if (provisionalDst) {
      // The source finalised while its translation is still being revised —
      // Soniox stops sending provisional source the moment it commits the
      // utterance, but keeps rewriting the translation for a moment after. The
      // in-flight line has to survive that window, or the live translation
      // blinks out and reappears as a finished turn, which reads worse than
      // never having shown it.
      const head = list[0];
      if (head) {
        head.provisionalDst = provisionalDst;
      } else {
        list.unshift({
          speaker: null,
          speakerIndex: 0,
          provisional: null,
          provisionalDst,
          turns: [],
        });
      }
    }

    return list;
  }, [turns, provisional, provisionalDst, history, fromHistory, fromMemory, speakerOrder]);

  /**
   * Follow the newest line while the reader is at the top; hold their place in
   * the text while they are not.
   *
   * This is what `maintainVisibleContentPosition` did on mobile. The browser
   * has its own version — scroll anchoring — but it is disabled at scrollTop 0,
   * absent in Safari, and easily defeated by the sticky header, so the shift is
   * measured and cancelled explicitly instead. `useLayoutEffect`, not
   * `useEffect`: the correction has to land before the browser paints, or the
   * text visibly jumps.
   */
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    // Reading `scrollHeight` forces a synchronous layout of the whole
    // transcript, and this effect runs at token rate because `items` is a new
    // array on every provisional update. When the reader is at the top there is
    // nothing to correct — the scroll position is pinned — so the two reads
    // that used to happen anyway were pure cost, paid several times a second on
    // the thread the audio pipeline shares. `lastHeight` is only consulted
    // while not following, so leaving it stale here is safe; the first frame
    // after the reader scrolls away re-establishes it.
    if (following) {
      list.scrollTop = 0;
      wasFollowing.current = true;
      return;
    }

    const height = list.scrollHeight;
    // First frame after the reader scrolled away: `lastHeight` was left behind
    // while following, so the difference against it is meaningless and would
    // yank the view. Re-establish the baseline and correct nothing this time.
    if (wasFollowing.current) {
      wasFollowing.current = false;
      lastHeight.current = height;
      return;
    }

    const grew = height - lastHeight.current;
    if (grew > 0) list.scrollTop += grew;
    lastHeight.current = height;
  }, [items, following]);

  const onScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    // A little slack: momentum can leave the offset a pixel or two off zero
    // after an auto-scroll, and a tight threshold treated that as "the reader
    // has scrolled away".
    const nearTop = list.scrollTop <= FOLLOW_SLACK_PX;
    setFollowing((was) => (was === nearTop ? was : nearTop));
  }, []);

  // ── actions ────────────────────────────────────────────────────────
  const toggleSource = useCallback((id: number) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const onStart = useCallback(async () => {
    // A new session starts folded shut. Cleared here rather than in an effect
    // watching `turns` — a start is exactly the event that means "this is a new
    // transcript".
    setRevealedIds(new Set<number>());
    setPanelRotation(0);
    setPanelSwap([false, false]);
    setPanelsReversed(false);
    const result = await session.start();
    if (result === 'not-configured') {
      // Nothing the user can do about this one — the deployment has no key, so
      // say that plainly rather than sending them to a settings screen that has
      // never had a field.
      setStartAlert({
        title: 'Not configured',
        message: 'This deployment was published without a translation key. Contact whoever runs it.',
      });
    } else if (result === 'permission-denied') {
      setStartAlert({
        title: 'Microphone permission needed',
        message: 'Allow microphone access for this site from the padlock in the address bar.',
      });
    } else if (result === 'start-failed') {
      setStartAlert({
        title: 'Could not open the microphone',
        message: 'Another app or tab may be using it.',
      });
    }
  }, [session]);

  const onCopyAll = useCallback(async () => {
    const text = turns.map((t) => t.dst || t.src).join('\n');
    await copyToClipboard(text);
    setOverflowOpen(false);
  }, [turns]);

  // Stop never discards silently and never saves silently — it always asks.
  const onStop = useCallback(async () => {
    setOverflowOpen(false);
    await session.stop();
    // Nothing was captured — there is no decision to put to the user, and an
    // empty session in the Library is just litter.
    if (useLive.getState().turns.length === 0) {
      await session.discardSession();
      return;
    }
    setAskingToSave(true);
  }, [session]);

  const onSave = useCallback(
    async (title: string) => {
      setAskingToSave(false);
      const id = await session.keepSession(title);
      // The summary runs detached: the user is free to leave this screen, and
      // Library detail picks the result up whenever they open the session.
      if (id && summaryAvailable) generateInBackground(id);
    },
    [summaryAvailable, session]
  );

  const onDiscard = useCallback(async () => {
    setAskingToSave(false);
    await session.discardSession();
  }, [session]);

  const adjustFont = useCallback(
    (delta: number) => {
      const next = Math.max(
        MIN_TRANSCRIPT_SIZE,
        Math.min(MAX_TRANSCRIPT_SIZE, prefs.fontSize + delta)
      );
      setPref('fontSize', next);
    },
    [prefs.fontSize, setPref]
  );

  // ── derived chrome ─────────────────────────────────────────────────
  const reconnecting = status === 'connecting' && reconnectAttempt > 0;
  const statusTitle = !running
    ? 'Ready'
    : reconnecting
      ? 'Reconnecting'
      : status === 'connecting'
        ? 'Connecting'
        : status === 'error'
          ? 'Error'
          : 'Listening';

  const dotTone: DotTone = !running
    ? 'idle'
    : status === 'error'
      ? 'error'
      : reconnecting || status === 'connecting'
        ? 'warn'
        : 'live';

  const twoWay = prefs.viewMode === 'panels';
  const resolvedA = resolveLanguage(prefs.languageA);
  const resolvedB = resolveLanguage(prefs.languageB);

  const toggleTwoWay = useCallback(() => {
    setOverflowOpen(false);
    if (twoWay) {
      merge({ viewMode: 'stream', translationType: 'one_way' });
    } else {
      merge({
        viewMode: 'panels',
        translationType: 'two_way',
        languageA: prefs.sourceLanguage,
        languageB: resolveLanguage(prefs.targetLanguage),
      });
    }
  }, [twoWay, prefs.sourceLanguage, prefs.targetLanguage, merge]);

  // Two-way forces landscape so each panel gets enough width.
  useEffect(() => {
    if (twoWay && running) void lockLandscape();
    else void unlockOrientation();
    return () => { void unlockOrientation(); };
  }, [twoWay, running]);

  const twoWayPanelData = useMemo<[TwoWayPanelData, TwoWayPanelData] | null>(() => {
    if (!twoWay) return null;

    // Position of each turn in `turns`, built once per recompute.
    //
    // The interruption check below needs to know where two turns sit relative
    // to each other in the full stream. It used to answer that with a
    // `findIndex` that allocated a string and ran `.split()` on every
    // comparison, plus an `indexOf` — for every turn, over the whole 1000-turn
    // array, twice (once per panel), at token rate. One map turns that from
    // quadratic into a lookup, on the same thread the audio pipeline runs on.
    const indexOfTurn = new Map<number, number>();
    for (let i = 0; i < turns.length; i++) indexOfTurn.set(turns[i].id, i);

    const buildLines = (lang: string) => {
      const own = turns.filter((t) => t.language === lang);

      // Group consecutive same-speaker turns within RUN_GAP_MS into one block.
      // A different speaker interrupting (in any language) also breaks the block,
      // so we check against the full turn list, not just this language's subset.
      type Block = {
        id: string;
        firstTurnId: number;
        texts: string[];
        lastCreatedAt: number;
        speaker: string | null;
      };
      const blocks: Block[] = [];

      for (const t of own) {
        // Two-way panels exist so each reader sees the OTHER language. Show
        // only the translation; falling back to the source would put the
        // wrong language in the panel and confuse the reader.
        const text = t.dst;
        if (!text) continue;
        const prev = blocks[blocks.length - 1];

        // Does this turn continue the previous block?
        // Break if: no previous, different speaker, too long since last turn,
        // or another speaker spoke in between (check the full turns array).
        let interrupted = false;
        if (prev) {
          // Look for any turn from a *different* speaker that landed between
          // the previous block's last turn and this one.
          const prevIdx = indexOfTurn.get(prev.firstTurnId) ?? -1;
          const curIdx = indexOfTurn.get(t.id) ?? -1;
          if (prevIdx >= 0 && curIdx > prevIdx + 1) {
            for (let k = prevIdx + 1; k < curIdx; k++) {
              if (turns[k].speaker !== t.speaker) { interrupted = true; break; }
            }
          }
        }

        const continues =
          prev &&
          prev.speaker === t.speaker &&
          t.createdAt - prev.lastCreatedAt <= TWO_WAY_GAP_MS &&
          !interrupted;

        if (continues && prev) {
          prev.texts.push(text);
          prev.lastCreatedAt = t.createdAt;
          // Keep the first turn's id as block key
        } else {
          blocks.push({
            id: `t${t.id}`,
            firstTurnId: t.id,
            texts: [text],
            lastCreatedAt: t.createdAt,
            speaker: t.speaker,
          });
        }
      }

      const lines = blocks
        .slice(-prefs.maxLinesKept)
        .reverse()
        .map((b, i) => ({
          id: b.id,
          text: b.texts.join(' '),
          state: (i < 2 ? 'final' : 'old') as 'live' | 'final' | 'old',
        }));

      if (provisional?.text && provisional.language === lang) {
        // Show the source text live while speaking; once the translation
        // preview arrives, switch to it so the reader sees the target language.
        //
        // Only if that preview is going the same way as this panel. A frame can
        // still be carrying the tail of the *other* speaker's translation while
        // these first words come in, and showing it here would put the previous
        // turn's text above the wrong column for as long as it takes the real
        // preview to arrive.
        const dstMatches = !provisionalDstLang || provisionalDstLang === lang;
        const liveText = (dstMatches && provisionalDst) || provisional.text;
        // Append to the newest block if same speaker is still talking
        const head = lines[0];
        const headSpeaker = blocks.length > 0 ? blocks[blocks.length - 1].speaker : null;
        if (head && provisional.speaker === headSpeaker) {
          head.text = liveText + ' ' + head.text;
          head.state = 'live';
        } else {
          lines.unshift({ id: 'provisional', text: liveText, state: 'live' });
        }
      }

      return lines;
    };

    // Each panel can independently swap its direction.
    const make = (index: number, defaultSrc: string, defaultTgt: string, srcKey: 'a' | 'b', tgtKey: 'a' | 'b') => {
      const swapped = panelSwap[index];
      const src = swapped ? defaultTgt : defaultSrc;
      const tgt = swapped ? defaultSrc : defaultTgt;
      const pickSrc = swapped ? tgtKey : srcKey;
      const pickTgt = swapped ? srcKey : tgtKey;
      return {
        sourceLabel: shortCode(src),
        targetLabel: shortCode(tgt),
        onPickSource: () => router.push(`/language-picker?target=${pickSrc}`),
        onPickTarget: () => router.push(`/language-picker?target=${pickTgt}`),
        onSwap: () => setPanelSwap((s) => { const n = [...s]; n[index] = !n[index]; return n; }),
        lines: buildLines(src),
      };
    };

    return [
      make(0, resolvedA, resolvedB, 'a', 'b'),
      make(1, resolvedB, resolvedA, 'b', 'a'),
    ] as [TwoWayPanelData, TwoWayPanelData];
  }, [
    twoWay,
    turns,
    provisional,
    provisionalDst,
    provisionalDstLang,
    resolvedA,
    resolvedB,
    prefs.maxLinesKept,
    router,
    panelSwap,
  ]);

  // Source keeps 'AUTO' — that is a real mode (Soniox detects it). The target
  // never is: 'auto' means "follow the device", so show what it actually
  // resolves to rather than a second, meaningless AUTO.
  const langPair = `${shortCode(prefs.sourceLanguage)} → ${shortCode(resolveLanguage(prefs.targetLanguage))}`;
  const displayPair = twoWay
    ? `${shortCode(resolvedA)} ↔ ${shortCode(resolvedB)}`
    : langPair;
  const saveSubtitle = [
    `${Math.max(1, Math.round(elapsedSec / 60))} minutes`,
    `${turns.length} turns`,
    speakerOrder.length > 0 ? `${speakerOrder.length} speakers` : null,
    displayPair,
  ]
    .filter(Boolean)
    .join(' · ');
  const speakerCount = speakerOrder.length;
  /**
   * One size, in both orientations — no landscape multiplier.
   *
   * The mockup scales table mode 1.4×, but that factor came from its artboard
   * proportions rather than from a real screen. Landscape actually has *less*
   * than half the vertical room of portrait, so enlarging the type there fights
   * the axis that is already scarce.
   *
   * And the size is the user's to set: A⁺ and the 12-48 slider control it
   * directly, so a hidden multiplier just overrides what they picked.
   */
  const fontSize = prefs.fontSize;

  const renderItem = (item: ListItem, key: string) => {
    const lines: TurnLine[] = [];

    if (item.provisional || item.provisionalDst) {
      // No id, no pairing yet, nothing to reveal — inert until it finalises.
      //
      // `dst` is what TurnView renders as the primary text. Once Soniox is
      // sending a running translation that goes here and the source becomes the
      // annotation, which is the whole point: the reader watches the language
      // they can read, live, instead of waiting for the endpoint delay. Before
      // the first translated token arrives there is nothing to show but the
      // source, so it keeps the primary slot until then.
      lines.push({
        key: 'provisional',
        src: item.provisionalDst ? (item.provisional ?? '') : '',
        dst: item.provisionalDst ?? item.provisional ?? '',
        state: 'live',
        showSource: false,
      });
    }

    for (const { turn, state } of item.turns) {
      // Nothing to reveal unless the turn has both halves: one still waiting on
      // its translation is *already* showing its source as the primary line, so
      // a tap there would either do nothing or duplicate the text.
      const hasSource = !!turn.src && !!turn.dst;
      lines.push({
        key: `t${turn.id}`,
        src: turn.src,
        dst: turn.dst,
        state,
        showSource: hasSource && revealedIds.has(turn.id),
        onPress: hasSource ? () => toggleSource(turn.id) : undefined,
      });
    }

    return (
      <TurnView
        key={key}
        speakerName={speakerDisplayName(item.speaker, speakerNames, speakerOrder)}
        speakerIndex={item.speakerIndex}
        lines={lines}
        fontSize={fontSize}
      />
    );
  };

  const transcript = (
    <div ref={listRef} onScroll={onScroll} className={cx(styles.transcript, 'noscrollbar')}>
      {items.length > 0 ? (
        <div className={styles.newestHeader}>
          <NewestDivider />
        </div>
      ) : null}
      {items.map((item) =>
        renderItem(
          item,
          // Keyed on the block's *oldest* turn, which is the one that does not
          // move: a run grows at its newest end, so keying on the first entry
          // would hand the block a new key every time it gained a line.
          item.turns.length > 0 ? `b${item.turns[item.turns.length - 1].turn.id}` : 'provisional'
        )
      )}
      {/* At the bottom because the stream runs newest-first: down is backwards. */}
      {remaining > 0 ? (
        <button
          type="button"
          className={styles.viewMore}
          disabled={loadingMore}
          onClick={() => void loadMore()}>
          {loadingMore ? 'Loading…' : `View more (${remaining} older)`}
        </button>
      ) : null}
    </div>
  );

  // ── Two-way fullscreen ─────────────────────────────────────────────
  // Own early return so nothing else (strip, action bar) renders beneath
  // the rotated container. Stop + Rotate controls live inside the panels.
  if (twoWay && running && twoWayPanelData) {
    const displayedPanels: [TwoWayPanelData, TwoWayPanelData] = panelsReversed
      ? [twoWayPanelData[1], twoWayPanelData[0]]
      : twoWayPanelData;
    return (
      <Screen>
        <TwoWayPanels
          panels={displayedPanels}
          fontSize={fontSize}
          rotation={panelRotation}
          onRotate={() => setPanelRotation((r) => (r + 1) % 4)}
          onStop={onStop}
          onFontUp={() => adjustFont(4)}
          onFontDown={() => adjustFont(-4)}
          onSwapPanels={() => setPanelsReversed((r) => !r)}
        />
        {/* Dialogs must stay mounted so Save appears after Stop. */}
        <SaveDialog
          visible={askingToSave}
          subtitle={saveSubtitle}
          summaryEnabled={summaryAvailable}
          onSave={onSave}
          onDiscard={onDiscard}
        />
      </Screen>
    );
  }

  // ── Table mode (landscape) ─────────────────────────────────────────
  if (landscape && running) {
    // A pointer listener on the container, not a button wrapper: the transcript
    // scrolls, and wrapping it in something clickable would fight that. A raw
    // pointerdown bubbles from anywhere in the subtree, which is exactly the
    // "any touch wakes the chrome" behaviour this needs.
    return (
      <Screen>
        <div
          className={cx(styles.tableMode, dimmed && styles.dimmed)}
          onPointerDown={wakeChrome}>
          {chromeVisible ? (
            <div className={styles.landTop}>
              <StatusDot tone={dotTone} pulse={running} />
              <span className={styles.landTopText}>
                {displayPair}
                {speakerCount > 0 ? ` · ${speakerCount} speakers` : ''}
              </span>
              <span className={cx(styles.landTopText, styles.tabular)}>
                {formatElapsed(elapsedSec)} · ${estimateCost(elapsedSec).toFixed(2)}
              </span>
            </div>
          ) : null}
          {transcript}
        </div>
      </Screen>
    );
  }

  // ── Portrait ───────────────────────────────────────────────────────
  return (
    <Screen>
      <AppBar>
        <AppBarIcon
          glyph={(tint) => <HomeIcon color={tint} />}
          accessibilityLabel="Session library"
          onPress={() => router.push('/library')}
        />
        <StatusDot tone={dotTone} pulse={running} />
        <AppBarTitle muted={!running}>{statusTitle}</AppBarTitle>
        <InstallButton />
        {running ? (
          <span className={styles.meterLine}>
            <span className={styles.meterStrong}>{formatElapsed(elapsedSec)}</span>
            {` · $${estimateCost(elapsedSec).toFixed(2)}`}
          </span>
        ) : (
          <AppBarIcon
            glyph={(tint) => <SettingsIcon color={tint} />}
            accessibilityLabel="Settings"
            onPress={() => router.push('/settings')}
          />
        )}
        <AppBarIcon
          glyph="☰"
          accessibilityLabel="More options"
          active={overflowOpen}
          onPress={() => setOverflowOpen(true)}
        />
      </AppBar>

      {!running ? (
        <div className={styles.pills}>
          {twoWay ? (
            <>
              <Pill
                caret
                onPress={() => router.push('/language-picker?target=a')}
                accessibilityLabel="Language A">
                {shortCode(resolvedA)}
              </Pill>
              <Pill
                caret
                onPress={() => router.push('/language-picker?target=b')}
                accessibilityLabel="Language B">
                {shortCode(resolvedB)}
              </Pill>
            </>
          ) : (
            <>
              <Pill
                caret
                onPress={() => router.push('/language-picker?target=source')}
                accessibilityLabel="Source language">
                {shortCode(prefs.sourceLanguage)}
              </Pill>
              <span className={styles.arrow}>→</span>
              <Pill
                caret
                onPress={() => router.push('/language-picker?target=target')}
                accessibilityLabel="Target language">
                {shortCode(resolveLanguage(prefs.targetLanguage))}
              </Pill>
            </>
          )}
          <Pill caret onPress={toggleTwoWay} accessibilityLabel="Translation mode">
            {twoWay ? '↔ Two way' : '→ One way'}
          </Pill>
        </div>
      ) : null}

      {error ? (
        <Banner
          tone={reconnecting ? 'warn' : 'error'}
          glyph="⚠"
          text={
            reconnecting
              ? `Connection dropped — retrying (${reconnectAttempt}/${reconnectMax})`
              : error
          }
        />
      ) : null}

      {running && quiet ? (
        <Banner
          tone="warnSoft"
          glyph="🎙"
          text="Barely hearing anything. Move closer?"
          action="How?"
          onAction={() => router.push('/onboarding/1')}
        />
      ) : null}

      {Object.entries(suggestedNames).map(([id, suggestion]) => (
        <Banner
          key={id}
          tone="info"
          text={`${speakerDisplayName(id, speakerNames, speakerOrder)} might be "${suggestion.name}"`}
          action="Accept"
          onAction={() => acceptSuggestion(id)}
          onDismiss={() => dismissSuggestion(id)}
        />
      ))}

      {items.length === 0 ? (
        <div className={styles.center}>
          <IdleWave active={running} />
          <span className={styles.idleTitle}>{running ? 'Listening…' : 'Tap Start to listen'}</span>
          {!running ? (
            <p className={styles.hint}>
              Put your phone near the speaker
              <br />
              <button
                type="button"
                className={styles.hintLink}
                onClick={() => router.push('/onboarding/1')}>
                How? →
              </button>
            </p>
          ) : null}
        </div>
      ) : (
        transcript
      )}

      {running && error && !reconnecting ? (
        <p className={styles.reassurance}>Nothing is lost — your transcript is already saved.</p>
      ) : null}

      <div className={styles.strip}>
        <LevelMeter />
        <span className={styles.stripText}>
          {running
            ? `${displayPair}${speakerCount > 0 ? ` · ${speakerCount} speakers` : ''}`
            : 'Mic level — quiet'}
        </span>
      </div>

      <ActionBar>
        {running && error && !reconnecting ? (
          <>
            <Cta label="Save & end" variant="ghost" flex={1} onPress={onStop} />
            <Cta label="Retry now" flex={1} onPress={() => void session.retry()} />
          </>
        ) : running ? (
          <>
            <Cta label="■  Stop" variant="stop" flex={1} onPress={onStop} />
            <IconBtn
              glyph="⋯"
              accessibilityLabel="More options"
              onPress={() => setOverflowOpen(true)}
            />
          </>
        ) : (
          <>
            <Cta label="▶  Start" flex={1} onPress={onStart} />
            <IconBtn
              glyph="A⁺"
              accessibilityLabel={`Text size ${prefs.fontSize}px — tap to increase`}
              onPress={() => adjustFont(4)}
            />
          </>
        )}
      </ActionBar>

      {MOCK_ENABLED ? <span className={styles.mockBadge}>MOCK ENGINE</span> : null}

      {/* ── ⋯ overflow: destinations above, session actions below ── */}
      <Sheet visible={overflowOpen} onClose={() => setOverflowOpen(false)}>
        <SheetGroup>Go to</SheetGroup>
        <SheetItem
          glyph={(tint) => <LibraryIcon color={tint} />}
          label="Library"
          onPress={() => {
            setOverflowOpen(false);
            router.push('/library');
          }}
        />
        <SheetItem glyph="📖" label="Read aloud" meta="Coming soon" disabled />
        <SheetItem
          glyph={(tint) => <SettingsIcon color={tint} />}
          label="Settings"
          onPress={() => {
            setOverflowOpen(false);
            router.push('/settings');
          }}
        />
        <SheetSeparator />
        <SheetGroup>This session</SheetGroup>
        <SheetItem
          glyph="↔"
          label="Mode"
          meta={twoWay ? 'Two way' : 'One way'}
          onPress={toggleTwoWay}
        />
        <SheetItem
          glyph="A"
          label="Text size"
          meta={`${prefs.fontSize} px`}
          onPress={() => {
            setOverflowOpen(false);
            router.push('/settings/display');
          }}
        />
        <SheetItem glyph="⧉" label="Copy all" onPress={onCopyAll} />
        <SheetItem glyph="⏹" label="Save & end session" danger onPress={onStop} />
      </Sheet>

      {/* ── speakers ── */}
      <Sheet visible={speakersOpen} onClose={() => setSpeakersOpen(false)}>
        <SheetGroup>
          {speakerCount > 0
            ? `${speakerCount} speakers in this session`
            : 'No speakers detected yet'}
        </SheetGroup>
        {speakerOrder.map((id) => (
          <SheetItem
            key={id}
            glyph="●"
            label={speakerDisplayName(id, speakerNames, speakerOrder) ?? id}
            meta={`${turnCounts[id] ?? 0} turns · rename`}
            onPress={() => setRenaming(id)}
          />
        ))}
        <SheetSeparator />
        <SheetNote>
          Labels are provisional early on and settle as Soniox hears more voice. Renaming applies
          retroactively to every turn.
        </SheetNote>
      </Sheet>

      <SaveDialog
        visible={askingToSave}
        subtitle={saveSubtitle}
        summaryEnabled={summaryAvailable}
        onSave={onSave}
        onDiscard={onDiscard}
      />

      <AlertDialog
        visible={startAlert !== null}
        title={startAlert?.title ?? ''}
        message={startAlert?.message}
        onClose={() => setStartAlert(null)}
      />

      <PromptDialog
        key={renaming ?? 'none'}
        visible={renaming !== null}
        title="Rename speaker"
        message="The new name applies to every earlier turn too."
        initialValue={renaming ? (speakerNames[renaming] ?? '') : ''}
        placeholder="e.g. Kenji"
        onCancel={() => setRenaming(null)}
        onConfirm={(value) => {
          if (renaming) renameSpeaker(renaming, value);
          setRenaming(null);
        }}
      />
    </Screen>
  );
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
