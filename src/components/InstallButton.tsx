/**
 * The app-bar control that puts the app on the device.
 *
 * Button and fallback live together because they are one behaviour: the button
 * is always on screen, and what happens on press depends on whether the browser
 * handed us a prompt. Splitting them would mean every screen that wants the
 * button also carries dialog state for a case it does not care about.
 *
 * It hides in exactly one situation — already running as an installed app —
 * where the offer would be nonsense.
 */
'use client';

import { useState } from 'react';

import { manualInstallHint, useInstallPrompt } from '@/hooks/useInstallPrompt';

import { AlertDialog } from './AlertDialog';
import { InstallIcon } from './icons';
import { AppBarButton } from './primitives';

export function InstallButton() {
  const { installed, install } = useInstallPrompt();
  const [hint, setHint] = useState<{ title: string; message: string } | null>(null);

  if (installed) return null;

  return (
    <>
      <AppBarButton
        glyph={(tint) => <InstallIcon color={tint} />}
        accessibilityLabel="Install this app on your device"
        onPress={() => {
          void install().then((result) => {
            if (result === 'unavailable') setHint(manualInstallHint());
          });
        }}>
        Install app
      </AppBarButton>

      <AlertDialog
        visible={hint !== null}
        title={hint?.title ?? ''}
        message={hint?.message}
        onClose={() => setHint(null)}
      />
    </>
  );
}
