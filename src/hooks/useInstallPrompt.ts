/**
 * The browser's own install prompt, held until the user asks for it.
 *
 * Chromium fires `beforeinstallprompt` when a site meets the install criteria —
 * manifest, icons, a valid HTTPS origin — and installs the app through its own
 * mini-infobar unless the event is cancelled. Cancelling it and keeping the
 * event is what lets a button in our own chrome do the asking, at a moment the
 * user chose.
 *
 * The event is held in module scope rather than in each caller's state, and
 * that is not a detail. It fires once per page load, and this app never loads a
 * page again after the first: routing is client-side, so a screen mounted by a
 * later navigation would start with an empty state and no second event coming.
 * The button existed on the first screen and vanished on every one after it.
 * One store, subscribed to by whoever is mounted, is what makes it survive the
 * trip from onboarding to Live.
 *
 * `canInstall` is deliberately NOT the same question as "should the button
 * exist". It is false on every browser that never fires the event — all of
 * Safari, and any Chrome that loaded the page over a certificate it does not
 * trust — and on those the user still wants to install, by a route the page
 * cannot drive. So the button stays and `manualInstallHint()` explains the
 * route. Only `installed` hides it, because there is nothing left to offer
 * someone already inside the installed app.
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

/** `display-mode` is how a launched PWA differs from the same page in a tab. */
const STANDALONE = '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)';

function subscribeDisplayMode(notify: () => void) {
  const query = window.matchMedia(STANDALONE);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

function isStandalone() {
  // `navigator.standalone` is the iOS-only equivalent, and the only signal
  // there: Safari reports `display-mode: browser` in a home-screen app.
  const ios = (navigator as { standalone?: boolean }).standalone === true;
  return ios || window.matchMedia(STANDALONE).matches;
}

export function useInstallPrompt() {
  // Null on the server and on the hydrating render: there is no event to have
  // caught yet, so the first paint matches what the server produced.
  const event = useSyncExternalStore(
    subscribe,
    () => deferred,
    () => null
  );
  const installed = useSyncExternalStore(
    subscribeDisplayMode,
    isStandalone,
    () => false
  );

  /**
   * Resolves to whether the browser's prompt actually opened. 'unavailable'
   * means the caller should say how to install by hand instead.
   */
  const install = useCallback(async (): Promise<'prompted' | 'unavailable'> => {
    if (!event) return 'unavailable';
    await event.prompt();
    await event.userChoice;
    /*
     * Spent either way. A dismissed prompt cannot be shown again from the same
     * event, and Chromium re-fires `beforeinstallprompt` on a later visit — so
     * dropping it puts the button back on the manual path rather than leaving a
     * control that silently does nothing.
     */
    publish(null);
    return 'prompted';
  }, [event]);

  return { canInstall: event !== null, installed, install };
}

/**
 * What to tell someone whose browser will not do it for them.
 *
 * The Chromium branch names the cause that is easiest to hit and hardest to
 * guess: Chrome will not offer installation on an origin whose certificate it
 * does not trust, so a self-signed dev server over the LAN loads perfectly and
 * offers nothing, with no error anywhere to explain it.
 */
export function manualInstallHint(): { title: string; message: string } {
  const ua = navigator.userAgent;
  const iOS =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (iOS) {
    return {
      title: 'Add to Home Screen',
      message:
        'Tap the Share button at the bottom of Safari, then choose “Add to Home Screen”. iOS has no install API for a page to call — this is the same install, just driven by you.',
    };
  }

  if (/Android/.test(ua)) {
    return {
      title: 'Install from the Chrome menu',
      message:
        'Open Chrome’s ⋮ menu and choose “Install app”. If that entry is not there, Chrome does not consider this page installable — most often because the page was opened over HTTPS with a certificate the phone does not trust. Installing the site’s root certificate, or reaching it over localhost, makes the entry appear.',
    };
  }

  if (/Firefox/.test(ua)) {
    return {
      title: 'Firefox cannot install this',
      message:
        'Desktop Firefox has no PWA install. Open the app in Chrome or Edge to install it, or just keep using it in this tab — everything works the same.',
    };
  }

  return {
    title: 'Install from the browser menu',
    message:
      'Open the browser menu and choose “Install app”, or use the install icon at the right of the address bar. If neither is there, the app may already be installed, or this page was not served from a trusted HTTPS origin.',
  };
}
