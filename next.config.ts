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
};

export default nextConfig;
