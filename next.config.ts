import type { NextConfig } from 'next';

// No `output: 'export'` — the app needs its API routes (Soniox token, OpenAI
// summary, MongoDB sessions). Pages are still client-rendered: every page file
// is `'use client'` and the tree sits behind a hydration gate.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: false },
  /*
   * Emits `.next/standalone` — a self-contained server with only the modules it
   * actually imports. It is what the Dockerfile ships, and it is the difference
   * between a ~200 MB image and a ~1 GB one. Harmless outside Docker: it is an
   * extra output directory nothing else reads.
   */
  output: 'standalone',
  /*
   * Compression belongs to Caddy, which fronts every deployed request and is
   * configured for `zstd gzip`. Left on, Next gzips first and Caddy can only
   * pass the already-encoded body through — so zstd, the reason that line names
   * it first, was never actually reaching anyone. Handing the job over also
   * takes it off the Node event loop, which this app shares with the API routes
   * that mint session keys.
   *
   * The trade-off is `npm start` without a proxy in front, which now serves
   * uncompressed. That is local testing over localhost, where it costs nothing
   * measurable — but it is the reason this is not simply "always faster".
   */
  compress: false,
  /*
   * `/_next/static/*` is content-hashed and Next already marks it immutable.
   * `public/` is not: it was served `max-age=0`, so every load revalidated the
   * worklet, the manifest and the icons over the network. They are versioned by
   * deploy rather than by URL, so the answer is a short cache plus revalidation,
   * not an immutable one — an hour of staleness for an icon is invisible, and
   * the service worker's stale-while-revalidate is what actually keeps them
   * current for installed clients.
   */
  async headers() {
    return [
      {
        source: '/:file(pcm-worklet.js|manifest.webmanifest|favicon.png)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' }],
      },
      {
        source: '/icons/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
