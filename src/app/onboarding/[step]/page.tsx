/**
 * Onboarding — two steps, about twenty seconds, zero typing.
 *
 * Step 1 asks for the microphone and teaches placement in the same breath: the
 * permission and the reason for it are one screen, which is the
 * highest-acceptance pattern there is, and capture quality is the biggest risk
 * to the whole experience.
 *
 * Step 2 just confirms the two languages of the conversation. There is no
 * source and no target: translation runs both ways, so each side is simply the
 * language the other one is read in. Keys are not part of onboarding at all —
 * the server holds them, so there is nothing for anyone to paste.
 *
 * The permission request is a bare `getUserMedia` whose stream is stopped
 * immediately. There is no "ask without recording" API in the browser: opening
 * the device *is* the prompt, so it is opened and closed at once, which leaves
 * the grant in place for the real session.
 */
'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ChevronDownIcon, ChevronLeftIcon } from '@/components/icons';
import { InstallButton } from '@/components/InstallButton';
import { StaticMeter } from '@/components/meter';
import { PlacementDiagram } from '@/components/PlacementDiagram';
import { AppBar, AppBarIcon, AppBarTitle, Cta, cx } from '@/components/primitives';
import { ActionBar, Screen, ScreenBody } from '@/components/Screen';
import { languageName } from '@/data/languages';
import { AUTO, deviceLanguage, useSettings } from '@/state/settingsStore';
import { color } from '@/theme/tokens';

import styles from './onboarding.module.css';

const LAST_STEP = 2;

export default function Onboarding() {
  const router = useRouter();
  const params = useParams<{ step?: string }>();
  const step = Math.min(LAST_STEP, Math.max(1, Number(params?.step ?? '1') || 1));

  const prefs = useSettings((s) => s.prefs);
  const setPref = useSettings((s) => s.set);
  const onboarded = prefs.onboarded;

  const [permissionDenied, setPermissionDenied] = useState(false);

  const finish = () => {
    setPref('onboarded', true);
    router.replace('/live');
  };

  const goToStep2 = () => router.replace('/onboarding/2');

  const requestMicrophone = async () => {
    if (onboarded) {
      router.replace('/live');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      goToStep2();
    } catch {
      setPermissionDenied(true);
    }
  };

  return (
    <Screen>
      <AppBar>
        {step > 1 ? (
          <AppBarIcon
            glyph={(tint) => <ChevronLeftIcon color={tint} />}
            accessibilityLabel="Back"
            onPress={() => router.replace('/onboarding/1')}
          />
        ) : null}
        <AppBarTitle>{step === 1 ? 'Let the phone listen' : 'The two languages'}</AppBarTitle>
        {/* `/` lands here on a device that has not onboarded, so this is the
            first screen most people ever see. */}
        <InstallButton />
        <span className={styles.stepCounter}>
          {step}/{LAST_STEP}
        </span>
      </AppBar>

      {step === 1 ? (
        <>
          <ScreenBody className={styles.body}>
            <PlacementDiagram />

            <span className={styles.lede}>
              My Translator listens to the room and translates what it hears, live. It works best
              when the phone sits <span className={styles.strong}>about 30 cm from the speaker</span>
              , mic pointed at the sound.
            </span>

            <div className={styles.tips}>
              <Tip glyph="🔊" text="Turn the laptop volume up one notch past comfortable." />
              <Tip glyph="⚠" text="Avoid tables that rattle — vibration reads as noise." />
            </div>

            <div className={styles.card}>
              <div className={styles.meterRow}>
                <StaticMeter />
                <span className={styles.meterLabel}>Good signal</span>
              </div>
              <p className={styles.cardNote}>
                The meter comes alive the moment access is granted — aim the phone and watch the
                bars.
              </p>
            </div>
          </ScreenBody>

          <ActionBar>
            {/* Reached again from the "How?" link on Live once onboarding is
                done — then it is just a placement reminder, not a permission
                gate, so it goes straight back instead of re-running the flow. */}
            <Cta
              label={onboarded ? 'Got it' : 'Allow microphone access'}
              flex={1}
              onPress={requestMicrophone}
            />
          </ActionBar>
        </>
      ) : (
        <>
          <ScreenBody className={styles.body}>
            <span className={styles.lede}>
              Pick the two languages of the conversation. Everything said in one comes back in the
              other, both ways at once. You can change them anytime from the pills on the main
              screen — even mid-session.
            </span>

            <div className={styles.secLabel}>LANGUAGE A</div>
            <Select
              label={
                prefs.languageA === AUTO
                  ? `✨ Auto — device language (${languageName(deviceLanguage())})`
                  : languageName(prefs.languageA)
              }
              highlighted={prefs.languageA === AUTO}
              onPress={() => router.push('/language-picker?target=a')}
            />
            <span className={styles.note}>
              One side of the table. Naming it explicitly, rather than leaving it on the device
              language, improves accuracy and speaker detection.
            </span>

            <div className={styles.secLabel}>LANGUAGE B</div>
            <Select
              label={
                prefs.languageB === AUTO
                  ? `✨ Auto — device language (${languageName(deviceLanguage())})`
                  : languageName(prefs.languageB)
              }
              highlighted={prefs.languageB === AUTO}
              onPress={() => router.push('/language-picker?target=b')}
            />
            <span className={styles.note}>
              The other side. Each panel shows this language translated into the one above, and the
              other way round.
            </span>
          </ScreenBody>

          <ActionBar>
            <Cta label="Start using it" flex={1} onPress={finish} />
          </ActionBar>
        </>
      )}

      {/*
        The mobile build used Alert.alert here. Continuing to step 2 either way
        is deliberate: the grant can still be given later from the browser's own
        site settings, and blocking the flow on it would strand the user on a
        screen with nothing to do.
      */}
      <ConfirmDialog
        visible={permissionDenied}
        title="Permission not granted"
        message="Without the microphone the app cannot hear anything. You can grant it later from the padlock in the address bar."
        confirmLabel="Continue"
        cancelLabel="Try again"
        onCancel={() => {
          setPermissionDenied(false);
          void requestMicrophone();
        }}
        onConfirm={() => {
          setPermissionDenied(false);
          goToStep2();
        }}
      />
    </Screen>
  );
}

function Tip({ glyph, text }: { glyph: string; text: string }) {
  return (
    <div className={styles.tip}>
      <span className={styles.tipGlyph}>{glyph}</span>
      <span className={styles.tipText}>{text}</span>
    </div>
  );
}

function Select({
  label,
  highlighted,
  onPress,
}: {
  label: string;
  highlighted?: boolean;
  onPress: () => void;
}) {
  return (
    <div className={styles.selectWrap}>
      <button
        type="button"
        onClick={onPress}
        aria-label={label}
        className={cx(styles.select, highlighted && styles.selectHighlighted)}>
        <span className={styles.selectLabel}>{label}</span>
        <ChevronDownIcon size={12} color={color.textMuted} />
      </button>
    </div>
  );
}
