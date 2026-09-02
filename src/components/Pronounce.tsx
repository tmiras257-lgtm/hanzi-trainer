import { useState } from 'react';
import { asrSupported, listenOnce, transcriptMatches } from '../lib/speech';

interface Props {
  target: string;
  pinyin: string;
}

type Status = { kind: 'idle' } | { kind: 'listening' } | { kind: 'done'; text: string; ok: boolean } | { kind: 'error'; message: string };

const ERRORS: Record<string, string> = {
  'no-speech': 'Ничего не услышал — попробуй ещё раз, ближе к микрофону.',
  'not-allowed': 'Браузер не дал доступ к микрофону.',
  'service-not-allowed': 'Браузер не дал доступ к микрофону.',
  timeout: 'Время вышло. Попробуй ещё раз.',
  network: 'Распознаванию нужен интернет — оно работает на сервере Google, не локально.',
};

export default function Pronounce({ target, pinyin }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  if (!asrSupported) {
    return (
      <p className="note subtle">
        Распознавание речи недоступно в этом браузере (нужен Chrome или Edge).
      </p>
    );
  }

  const start = async () => {
    setStatus({ kind: 'listening' });
    try {
      const r = await listenOnce();
      setStatus({ kind: 'done', text: r.transcript, ok: transcriptMatches(r.transcript, target) });
    } catch (e) {
      const key = (e as Error).message;
      setStatus({ kind: 'error', message: ERRORS[key] ?? 'Не получилось распознать.' });
    }
  };

  return (
    <div className="pronounce">
      <div className="pronounce-row">
        <button className="btn ghost sm" onClick={start} disabled={status.kind === 'listening'}>
          {status.kind === 'listening' ? '● Слушаю…' : '🎤 Произнести'}
        </button>
        <span className="pronounce-target">{pinyin}</span>
      </div>

      {status.kind === 'done' && (
        <p className={`pronounce-result ${status.ok ? 'ok' : 'miss'}`}>
          Распознано: <b>{status.text || '—'}</b> {status.ok ? '— совпало' : '— не совпало'}
        </p>
      )}
      {status.kind === 'error' && <p className="pronounce-result miss">{status.message}</p>}

      <p className="note subtle">
        Браузер возвращает только текст, без разбора тонов. Ошибка в тоне часто всё равно
        распознаётся как нужный иероглиф, поэтому «совпало» — не доказательство правильного тона.
        Это вспомогательная тренировка, а не тоновый анализатор.
      </p>
    </div>
  );
}
