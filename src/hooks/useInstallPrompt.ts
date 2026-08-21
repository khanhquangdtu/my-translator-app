/**
 * The browser's own install prompt, held until the user asks for it.
 *
 * Chromium fires `beforeinstallprompt` when a site meets the install criteria —
 * manifest, icons, HTTPS — and installs the app through its own mini-infobar
 * unless the event is cancelled. Cancelling it and keeping the event is what
 * lets a button in our own chrome do the asking, at a moment the user chose.
 *
 * `canInstall` is therefore also the answer to "should the button exist": it is
 * false before the criteria are met, false once the app is installed, and false
 * on every browser that never fires the event at all — Safari, desktop and iOS
 * alike, where installing is a Share-sheet action with no web API behind it.
 *
 * The event is held in module scope rather than in each caller's state, and
 * that is not a detail. It fires once per page load, and this app never loads a
 * page again after the first: routing is client-side, so a screen mounted by a
 * later navigation would start with an empty state and no second event coming.
 * The button existed on the first screen and vanished on every one after it.
 * One store, subscribed to by whoever is mounted, is what makes it survive the
 * trip from onboarding to Live.
 */
'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Not in lib.dom: the event is a Chromium extension to the platform, and TS
 * ships no type for it.
 */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();
let listening = false;

function publish(next: BeforeInstallPromptEvent | null) {
  deferred = next;
  for (const notify of subscribers) notify();
}

/**
 * Attached on first subscribe rather than at import, so the module stays inert
 * on the server and nothing touches `window` during the build.
 */
function listen() {
  if (listening) return;
  listening = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    publish(event as BeforeInstallPromptEvent);
  });
  // Fires whether the install came from our button or the browser's own menu,
  // and is the only signal for the latter.
  window.addEventListener('appinstalled', () => publish(null));
}

function subscribe(notify: () => void) {
  listen();
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

export function useInstallPrompt() {
  // Null on the server and on the hydrating render: there is no event to have
  // caught yet, so the button is simply absent from the first paint.
  const event = useSyncExternalStore(
    subscribe,
    () => deferred,
    () => null
  );

  const install = useCallback(async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    /*
     * Spent either way. A dismissed prompt cannot be shown again from the same
     * event, and Chromium re-fires `beforeinstallprompt` on a later visit — so
     * dropping it hides the button until there is a live event behind it again,
     * rather than leaving a control that silently does nothing.
     */
    publish(null);
  }, [event]);

  return { canInstall: event !== null, install };
}
