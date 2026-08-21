/**
 * The document shell.
 *
 * Deliberately thin: it sets the font, the theme colour and the PWA manifest,
 * and hands everything below it to a client tree. There is no server rendering
 * of app content — the app is a client app that happens to have API routes
 * behind it, and the screens read from stores that only exist in the browser.
 */
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import '@/theme/globals.css';

import { Providers } from './providers';

/**
 * The three weights the mockup uses. Everything else in the design derives from
 * size and colour, not weight, so loading more would be dead payload. Served
 * from our own origin by next/font, which also means the app still has its type
 * offline.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'My Translator App',
  description: 'Real-time speech translation. Put the phone down, tap Start, read the translation.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Translator' },
  icons: { icon: '/favicon.png', apple: '/icons/icon-1024.png' },
};

export const viewport: Viewport = {
  themeColor: '#0F0F14',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // The transcript has its own size control; pinch-zoom on top of it just
  // knocks the layout sideways mid-session.
  maximumScale: 1,
  userScalable: false,
  // Lets the layout reach under the notch, which is what --inset-* then pads
  // back out where it matters.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
