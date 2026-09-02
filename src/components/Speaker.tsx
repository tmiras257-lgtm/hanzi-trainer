import { useEffect, useState } from 'react';
import { onVoicesReady, speak, ttsSupported, chineseVoices } from '../lib/speech';

interface Props {
  text: string;
  voiceURI?: string | null;
  label?: string;
  className?: string;
  slow?: boolean;
}

export default function Speaker({ text, voiceURI, label, className = '', slow }: Props) {
  const [ready, setReady] = useState(() => chineseVoices().length > 0);

  useEffect(() => onVoicesReady(() => setReady(chineseVoices().length > 0)), []);

  if (!ttsSupported) return null;

  return (
    <button
      className={`btn ghost sm ${className}`}
      onClick={() => speak(text, { voiceURI, rate: slow ? 0.6 : 0.85 })}
      title={ready ? 'Озвучить' : 'Китайский голос не найден в системе'}
      disabled={!ready}
    >
      🔊 {label ?? 'Озвучить'}
    </button>
  );
}
