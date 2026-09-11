import { useEffect, useState } from 'react';
import { onVoicesReady, speak, stopSpeaking, voiceStatus, VOICE_HELP, type VoiceStatus } from '../lib/speech';

export function useVoiceStatus(): VoiceStatus {
  const [status, setStatus] = useState<VoiceStatus>(() => voiceStatus());
  useEffect(() => onVoicesReady(() => setStatus(voiceStatus())), []);
  return status;
}

interface Props {
  text: string;
  voiceURI?: string | null;
  rate?: number;
  label?: string;
  className?: string;
  /** Speak once as soon as this value changes. */
  autoPlayKey?: string | number;
}

/**
 * The old version disabled this button whenever no Chinese voice had loaded,
 * which on macOS Chrome is most of the time at first paint — the button simply
 * looked broken. Now it stays live, and the reason is stated when it cannot work.
 */
export default function Speaker({ text, voiceURI, rate, label, className = '', autoPlayKey }: Props) {
  const status = useVoiceStatus();
  const [playing, setPlaying] = useState(false);

  const play = () => {
    if (!speak(text, { voiceURI, rate, onStart: () => setPlaying(true), onEnd: () => setPlaying(false) })) {
      setPlaying(false);
    }
  };

  useEffect(() => {
    if (autoPlayKey === undefined || status !== 'ready' || !text) return;
    const id = window.setTimeout(play, 180);
    return () => {
      window.clearTimeout(id);
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlayKey, status, text]);

  useEffect(() => () => stopSpeaking(), []);

  return (
    <button
      className={`btn ${className}`}
      onClick={play}
      disabled={status === 'unsupported'}
      title={status === 'ready' ? 'Прослушать' : VOICE_HELP[status]}
      aria-label={label ?? 'Прослушать'}
    >
      <SoundIcon on={playing} />
      {label ?? 'Прослушать'}
    </button>
  );
}

export function SoundIcon({ on = false }: { on?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" stroke="none" />
      {on ? (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      ) : (
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      )}
    </svg>
  );
}

/** Shown wherever synthesis is required and unavailable. */
export function VoiceNotice() {
  const status = useVoiceStatus();
  if (status === 'ready' || status === 'loading') return null;
  return (
    <div className="notice warn">
      <svg className="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{VOICE_HELP[status]}</span>
    </div>
  );
}
