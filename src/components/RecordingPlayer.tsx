'use client';

import { useEffect, useRef, useState } from 'react';

import { listRecordings, readRecording, recordingExtension, type RecordingClip } from '@/lib/audio/recordings';

import styles from './RecordingPlayer.module.css';

export function RecordingPlayer({ sessionId, expected }: { sessionId: string; expected?: boolean }) {
  const [clips, setClips] = useState<RecordingClip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void listRecordings(sessionId).then((rows) => { if (!cancelled) setClips(rows); })
      .catch(() => { if (!cancelled) setError('Could not open audio storage on this device.'); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [sessionId]);

  return (
    <section className={styles.recording} aria-label="Conversation recording">
      <h2>Conversation recording</h2>
      <p className={styles.note}>Audio is saved on this device. Download a copy to keep or share it.</p>
      {error ? <p role="alert">{error}</p> : !loaded ? <p>Loading audio…</p> : clips.length === 0 ? (
        <p>{expected ? 'This recording is on the device where the conversation was recorded.' : 'No audio was recorded for this conversation.'}</p>
      ) : clips.map((clip, index) => (
        <ClipPlayer key={clip.id} clip={clip} label={clips.length > 1 ? `Part ${index + 1}` : 'Recording'} />
      ))}
    </section>
  );
}

function ClipPlayer({ clip, label }: { clip: RecordingClip; label: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const duration = clip.durationMs / 1000;

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    void readRecording(clip).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (!cancelled) setError('Could not load this recording. Please reopen the conversation.'); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [clip]);

  const toggle = async () => {
    if (!audio.current) return;
    if (!audio.current.paused) { audio.current.pause(); return; }
    try {
      setError('');
      if (audio.current.ended) audio.current.currentTime = 0;
      await audio.current.play();
    } catch { setError('Could not play this audio. Try downloading it instead.'); }
  };

  return (
    <div className={styles.clip}>
      <div className={styles.heading}>
        <span>{label} · {clock(duration)} · {size(clip.bytes)}</span>
        {url && <a href={url} download={`${clip.sessionId}-${clip.id.slice(0, 8)}.${recordingExtension(clip.mimeType)}`}>Download audio</a>}
      </div>
      {!clip.complete && <p className={styles.note}>Recovered recording — the conversation ended before audio was finalised.</p>}
      <audio ref={audio} src={url || undefined} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)}
        onError={() => setError('This browser could not play the recording. You can still download it.')} />
      <div className={styles.controls}>
        <button type="button" disabled={!url} onClick={() => void toggle()} aria-label={playing ? 'Pause recording' : 'Play recording'}>
          {playing ? 'Ⅱ' : '▶'}
        </button>
        <input type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={Math.min(position, duration)}
          aria-label="Recording position" disabled={!url}
          onChange={(event) => { const time = Number(event.target.value); if (audio.current) audio.current.currentTime = time; setPosition(time); }} />
        <span className={styles.time}>{clock(position)} / {clock(duration)}</span>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  );
}

function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function size(bytes: number) {
  return bytes < 1_000_000 ? `${Math.ceil(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}
