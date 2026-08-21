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
 */

const VERSION = 'v1';
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

  // Everything else — build assets, fonts, the worklet, icons. These are
  // content-hashed or effectively static, so cache first is safe and fast.
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
});
