/**
 * The spoken drill: say the syllable, and the pitch tracker draws what your
 * voice actually did next to what the tone asks for.
 *
 * This is the part the old build got wrong. It asked the Web Speech API for a
 * transcript, which says nothing about tone — a wrong tone usually transcribes
 * to the right character anyway. Here the microphone is read directly and the
 * contour is measured, so the feedback is about pitch movement and nothing else.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PitchTracker, classifyTone, micAvailable, micErrorFrom, MIC_MESSAGES, resample, toContour, type MicError, type PitchFrame, type ToneReading } from '../lib/pitch';
import { TONE_NAMES } from '../lib/pinyin';
import type { SyllableEntry } from '../lib/syllables';
import ToneStaff from './ToneStaff';

/** Stop on its own after this long, so a forgotten recording does not run on. */
const MAX_MS = 4000;

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'result'; reading: ToneReading }
  | { kind: 'error'; message: string };

interface Props {
  syllable: SyllableEntry;
  /** 0..1 — confidence the reading must clear to count as passed. */
  strictness: number;
  onDone: (passed: boolean, confidence: number, retries: number) => void;
}

export default function SayTone({ syllable, strictness, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [live, setLive] = useState<number[]>([]);
  const [level, setLevel] = useState(0);
  const [retries, setRetries] = useState(0);

  const tracker = useRef<PitchTracker | null>(null);
  const frames = useRef<PitchFrame[]>([]);
  const stopTimer = useRef(0);

  const supported = micAvailable();
  const target = syllable.tone === 5 ? 1 : syllable.tone;

  const finish = useCallback(() => {
    window.clearTimeout(stopTimer.current);
    const t = tracker.current;
    if (!t) return;
    const collected = t.stop();
    tracker.current = null;
    setLevel(0);

    const reading = classifyTone(collected.length ? collected : frames.current);
    setPhase({ kind: 'result', reading });

    const heardRight = reading.tone === target;
    const passed = heardRight && reading.scores[target] >= Math.max(0.3, strictness * 0.9);
    onDone(passed, reading.tone ? reading.scores[target] : 0, retries);
    if (!passed) setRetries((n) => n + 1);
  }, [onDone, retries, strictness, target]);

  const start = useCallback(async () => {
    if (!supported) {
      setPhase({ kind: 'error', message: MIC_MESSAGES[window.isSecureContext ? 'unsupported' : 'insecure'] });
      return;
    }
    setLive([]);
    frames.current = [];
    const t = new PitchTracker();
    tracker.current = t;
    try {
      await t.start((f) => {
        frames.current.push(f);
        setLevel(Math.min(1, f.rms * 14));
        const contour = toContour(frames.current);
        if (contour.length >= 4) setLive(resample(contour, 20));
      });
      setPhase({ kind: 'recording' });
      stopTimer.current = window.setTimeout(finish, MAX_MS);
    } catch (e) {
      tracker.current = null;
      const kind: MicError = micErrorFrom(e);
      setPhase({ kind: 'error', message: MIC_MESSAGES[kind] });
    }
  }, [finish, supported]);

  useEffect(() => {
    setPhase({ kind: 'idle' });
    setLive([]);
    setRetries(0);
  }, [syllable.id]);

  useEffect(() => () => {
    window.clearTimeout(stopTimer.current);
    tracker.current?.stop();
    tracker.current = null;
  }, []);

  const recording = phase.kind === 'recording';
  const reading = phase.kind === 'result' ? phase.reading : null;
  const heardRight = reading?.tone === target;

  return (
    <div className="mic-wrap">
      <ToneStaff
        size="full"
        tone={target}
        voice={reading ? reading.shape : live}
        voiceTone={reading?.tone ?? null}
        label={`Эталон тона ${target} и контур голоса`}
      />

      <div className="row" style={{ justifyContent: 'center' }}>
        <button
          className={`mic-btn ${recording ? 'live' : ''}`}
          onClick={recording ? finish : start}
          disabled={!supported && phase.kind !== 'error'}
          aria-label={recording ? 'Остановить запись' : 'Записать голос'}
        >
          {recording ? (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          )}
        </button>
      </div>

      {recording && (
        <div className="level-track" aria-hidden="true">
          <div className="level-fill" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      )}

      <p className="tiny" style={{ textAlign: 'center', margin: 0 }}>
        {recording
          ? 'Говорю слушаю — произнеси слог и нажми ещё раз'
          : phase.kind === 'idle'
            ? `Скажи «${syllable.marked}» — ${TONE_NAMES[syllable.tone]}`
            : ''}
      </p>

      {reading && (
        <>
          {reading.tone === null ? (
            <p className="verdict no">
              Голоса не слышно. Скажи чуть громче и потяни гласную — нужно хотя бы полсекунды звука.
            </p>
          ) : (
            <p className={`verdict ${heardRight ? 'ok' : 'no'}`}>
              {heardRight
                ? `Похоже на тон ${target}`
                : `Услышал тон ${reading.tone} — ${TONE_NAMES[reading.tone]}, а нужен ${target}`}
            </p>
          )}

          <div className="readout">
            <span>уверенность <b>{Math.round(reading.scores[target] * 100)}%</b></span>
            <span>размах <b>{reading.range.toFixed(1)} пт</b></span>
            <span>наклон <b>{reading.slope > 0 ? '+' : ''}{reading.slope.toFixed(1)}</b></span>
            <span>длина <b>{Math.round(reading.voicedMs)} мс</b></span>
          </div>
          <p className="tiny" style={{ textAlign: 'center', margin: 0, maxWidth: '26rem' }}>{advice(reading, target)}</p>
        </>
      )}

      {phase.kind === 'error' && (
        <div className="notice bad">
          <svg className="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v5m0 3h.01" strokeLinecap="round" />
          </svg>
          <span>{phase.message}</span>
        </div>
      )}
    </div>
  );
}

/** Concrete, measurable advice rather than "try again". */
function advice(r: ToneReading, target: number): string {
  if (r.tone === null) return '';
  if (r.tone === target && r.scores[target] > 0.75) return 'Форма чистая — так и держи.';
  if (r.range < 2 && target !== 1) return 'Голос почти не двигается. Тон — это движение высоты, разгони его смелее.';
  if (target === 1 && r.range > 3) return 'Первый тон ровный: держи одну высоту, не давай голосу гулять.';
  if (target === 2 && r.slope < 2) return 'Второму тону нужен подъём до самого конца — как вопрос «да?».';
  if (target === 3 && r.slope < 0) return 'Третий тон сначала проваливается вниз, а потом идёт вверх. Верх в конце ты не добрал.';
  if (target === 4 && r.slope > -2) return 'Четвёртый тон падает резко и коротко — как приказ «стой!».';
  return 'Сравни линии: серая — эталон, цветная — твой голос.';
}
