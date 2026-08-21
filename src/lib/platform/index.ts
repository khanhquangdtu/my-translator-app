/**
 * The native APIs the mobile build used, and what stands in for them here.
 *
 * Every one of these degrades to a no-op rather than throwing. They are all
 * conveniences — keeping the screen lit, offering a share sheet — and none is
 * worth failing a session over, so a browser that lacks one simply does less.
 */
'use client';

// ─── expo-keep-awake ───────────────────────────────────────────────────

/**
 * Screen Wake Lock. Chromium-only at the time of writing, and it is released
 * automatically whenever the tab is hidden — so it is re-acquired on every
 * return to visibility, which is exactly the "phone put down, screen off,
 * picked back up" path this exists for.
 */
let wakeLock: WakeLockSentinel | null = null;
let wakeWanted = false;

async function acquireWakeLock() {
  if (!wakeWanted || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    wakeLock?.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    // Unsupported, or refused because the document was not visible.
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') void acquireWakeLock();
}

export async function activateKeepAwake(): Promise<void> {
  if (wakeWanted) return;
  wakeWanted = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
  await acquireWakeLock();
}

export function deactivateKeepAwake(): void {
  wakeWanted = false;
  document.removeEventListener('visibilitychange', onVisibilityChange);
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// ─── expo-clipboard ────────────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ─── expo-sharing ──────────────────────────────────────────────────────

/**
 * `navigator.share` where it exists, a download otherwise.
 *
 * Both are the same gesture from the user's side — "get this transcript out of
 * the app" — so they are one function. File sharing is checked with `canShare`
 * because several browsers expose `share` for links but reject files.
 */
export async function shareTextFile(
  filename: string,
  body: string,
  mimeType: string
): Promise<void> {
  const file = new File([body], filename, { type: mimeType });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      // The user dismissed the sheet — not a failure, and not worth falling
      // through to a surprise download.
      if ((err as DOMException)?.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next frame: revoking synchronously races the download start
  // in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── expo-screen-orientation ───────────────────────────────────────────

/**
 * Orientation locking needs fullscreen and only works on mobile, so this is
 * best-effort. Nothing depends on it: the landscape branch keys off
 * `width > height` either way, and the lock only saves the user from having to
 * hold the phone sideways themselves.
 */
export async function lockLandscape(): Promise<void> {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    }
    await (
      screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
    ).lock?.('landscape');
  } catch {
    // Desktop, or a browser that refuses. The layout still follows the window.
  }
}

export async function unlockOrientation(): Promise<void> {
  try {
    screen.orientation?.unlock?.();
    if (document.fullscreenElement) await document.exitFullscreen?.();
  } catch {
    // never locked in the first place
  }
}
