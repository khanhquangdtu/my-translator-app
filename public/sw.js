/**
 * Service worker — offline app shell only.
 *
 * The scope is deliberately narrow. Session data has its own offline story
 * (IndexedDB plus an outbox, in `lib/sessions/store.ts`), so this worker's only
 * job is making sure the app itself opens without a network: shell, worklet,
 * icons, and whatever build assets have been fetched once.
 *
 * `/api/*` is never cached, under any strategy. A cached session list would
 * show sessions that have been deleted, and a cached POST response would look
 * like a summary that was never generated — both worse than an honest error.
 *
 * Two strategies for what is left, split on whether the URL identifies the
 * content. Content-hashed build output is cache-first; everything else is
 * stale-while-revalidate, so a redeployed asset at an unchanged URL is picked
 * up rather than pinned forever. Bumping VERSION drops both caches on the next
 * activate, which is the blunt instrument for when that is not enough.
 */

const VERSION = 'v2';
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;

/**
 * The offline fallback document. Next serves a client-rendered app, so one
 * cached HTML entry point boots every route; the router takes it from there.
 */
const SHELL_URL = '/';

const PRECACHE = [
  SHELL_URL,
  '/manifest.webmanifest',
  '/pcm-worklet.js',
  '/favicon.png',
  '/icons/icon-1024.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, not addAll: one 404 in the list would otherwise abort the
      // whole install and leave the app with no worker at all.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first, so a deploy is picked up on the next load, and
  // the cached shell only when there is nothing to reach.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached ?? Response.error()))
    );
    return;
  }

  // `/_next/static/*` is content-hashed: a changed file gets a changed URL, so
  // a hit can never be stale and cache-first is both safe and the fastest
  // answer available.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              void caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  /*
   * Everything else in `public/` — the worklet, the manifest, the icons —
   * carries no hash, so its URL is the same forever. Cache-first therefore had
   * no way back: `/pcm-worklet.js` was precached on install and served from
   * that copy for the life of the installation, which meant a fix shipped to
   * the audio capture path would never reach anyone who had already opened the
   * app. That is the microphone, on the latency path this whole worker sits
   * beside.
   *
   * Stale-while-revalidate keeps the instant answer and adds a way back: serve
   * the cached copy, fetch the real one alongside it, and have the next load
   * pick up whatever changed. One load behind, rather than permanently behind.
   */
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch((err) => {
          // Offline with nothing cached is a genuine failure; offline with a
          // cached copy already returned is not, and must not reject.
          if (cached) return cached;
          throw err;
        });

      return cached ?? network;
    })
  );
});
