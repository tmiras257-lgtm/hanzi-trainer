import { useEffect, useMemo, useState } from 'react';
import type { AppState, Hanzi } from '../lib/types';
import { BY_CHAR, CHARACTERS } from '../lib/store';
import { buildSession, phaseLabel, type Step } from '../lib/session';
import { gradeWriting } from '../lib/srs';
import { gloss, maskChar, syllables, toneOf } from '../lib/format';
import { prefetch } from '../lib/strokes';
import { speak, ttsSupported } from '../lib/speech';
import { useStroke } from '../lib/useStroke';
import Writer, { type WriteResult } from './Writer';
import CharDetails from './CharDetails';
import Pronounce from './Pronounce';

interface Props {
  state: AppState;
  actions: ReturnType<typeof import('../lib/store').useAppState>['actions'];
  onExit: () => void;
}

interface Tally {
  learned: number;
  reviewed: number;
  correct: number;
  wrong: number;
  xpStart: number;
}

export default function SessionView({ state, actions, onExit }: Props) {
  const voice = state.profile.ttsVoice;
  const [plan] = useState(() => buildSession(CHARACTERS, BY_CHAR, state, { audio: ttsSupported }));
  const [queue, setQueue] = useState<Step[]>(plan.steps);
  const [i, setI] = useState(0);
  const [tally, setTally] = useState<Tally>({ learned: 0, reviewed: 0, correct: 0, wrong: 0, xpStart: state.profile.xp });
  const [startedAt] = useState(() => Date.now());

  useEffect(() => {
    prefetch(queue.filter((s) => s.kind !== 'quiz').map((s) => (s as { c: string }).c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = queue[i];
  const done = i >= queue.length;

  const next = () => setI((n) => n + 1);

  /** Failed cards come back later in the same session rather than waiting a day. */
  const requeue = (s: Step) => {
    setQueue((q) => {
      const copy = q.slice();
      const at = Math.min(q.length, i + 4 + Math.floor(Math.random() * 3));
      copy.splice(at, 0, { ...s, id: `${s.id}-again` });
      return copy;
    });
  };

  if (done) {
    return (
      <Summary
        tally={tally}
        minutes={Math.round((Date.now() - startedAt) / 60000)}
        xpNow={state.profile.xp}
        streak={state.profile.streak}
        onExit={() => {
          actions.finishSession();
          onExit();
        }}
      />
    );
  }

  if (!step) {
    return (
      <div className="panel empty-session">
        <h2>На сегодня всё пусто</h2>
        <p>Нет карточек к повторению, и новые иероглифы кончились в текущем наборе.</p>
        <button className="btn" onClick={onExit}>
          Вернуться
        </button>
      </div>
    );
  }

  const progress = i / Math.max(1, queue.length);
  const counts = countByPhase(queue);

  return (
    <div className="session">
      <header className="session-head">
        <div className="phases">
          {(['warmup', 'learn', 'drill', 'quiz'] as const).map((p) => (
            <span key={p} className={`phase ${step.phase === p ? 'active' : ''} ${counts[p] ? '' : 'off'}`}>
              {phaseLabel(p)}
              {counts[p] > 0 && <b>{counts[p]}</b>}
            </span>
          ))}
        </div>
        <div className="session-right">
          <span className="note">
            {i + 1} / {queue.length}
          </span>
          <button className="btn ghost sm" onClick={onExit}>
            Прервать
          </button>
        </div>
      </header>
      <div className="progress thin">
        <div style={{ width: `${progress * 100}%` }} />
      </div>

      <main className="session-body">
        {step.kind === 'intro' && (
          <IntroStep
            key={step.id}
            h={BY_CHAR.get(step.c)!}
            knownComps={step.scored.knownComps}
            voice={voice}
            onNext={() => {
              actions.learn(step.c);
              setTally((t) => ({ ...t, learned: t.learned + 1 }));
              next();
            }}
          />
        )}

        {step.kind === 'trace' && (
          <TraceStep key={step.id} h={BY_CHAR.get(step.c)!} voice={voice} onNext={next} />
        )}

        {(step.kind === 'review' || step.kind === 'write') && (
          <RecallStep
            key={step.id}
            h={BY_CHAR.get(step.c)!}
            voice={voice}
            phase={step.phase}
            onResult={(r) => {
              const q = gradeWriting(r.mistakes, r.hintUsed, r.revealed);
              const advance = step.kind === 'review' || step.phase === 'learn';
              actions.recordWriting(step.c, q, advance);
              if (q < 3) {
                requeue(step);
                if (!advance) actions.rescheduleCard(step.c, 0);
              }
              setTally((t) => ({
                ...t,
                reviewed: t.reviewed + (advance ? 1 : 0),
                correct: t.correct + (q >= 3 ? 1 : 0),
                wrong: t.wrong + (q >= 3 ? 0 : 1),
              }));
            }}
            onNext={next}
          />
        )}

        {step.kind === 'quiz' && (
          <QuizStep
            key={step.id}
            q={step.q}
            voice={voice}
            onAnswer={(ok) => {
              actions.recordQuiz(step.q.target, ok);
              setTally((t) => ({ ...t, correct: t.correct + (ok ? 1 : 0), wrong: t.wrong + (ok ? 0 : 1) }));
            }}
            onNext={next}
          />
        )}
      </main>
    </div>
  );
}

function countByPhase(steps: Step[]) {
  const out = { warmup: 0, learn: 0, drill: 0, quiz: 0 };
  for (const s of steps) out[s.phase] += 1;
  return out;
}

/* ---------------------------------------------------------------- steps */

function IntroStep({
  h,
  knownComps,
  voice,
  onNext,
}: {
  h: Hanzi;
  knownComps: string[];
  voice: string | null;
  onNext: () => void;
}) {
  const { data, error } = useStroke(h.c);

  useEffect(() => {
    if (ttsSupported) speak(h.c, { voiceURI: voice });
  }, [h.c, voice]);

  return (
    <div className="step two-col">
      <div className="col-left">
        <span className="step-tag new">Новый иероглиф</span>
        {data ? (
          <Writer char={h.c} data={data} mode="animate" size={340} />
        ) : (
          <Placeholder error={error} />
        )}
      </div>
      <div className="col-right">
        <div className="big-char">{h.c}</div>
        <CharDetails h={h} voiceURI={voice} knownComps={knownComps} />
        <Pronounce target={h.c} pinyin={h.py} />
        <button className="btn primary wide" onClick={onNext}>
          Понятно — попробую обвести
        </button>
      </div>
    </div>
  );
}

function TraceStep({ h, voice, onNext }: { h: Hanzi; voice: string | null; onNext: () => void }) {
  const { data, error } = useStroke(h.c);
  const [finished, setFinished] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="step centered">
      <span className="step-tag">Обведи по контуру</span>
      <p className="prompt-line">
        <b className="pinyin">{h.py}</b> · {gloss(h)}
      </p>
      {data ? (
        <Writer
          char={h.c}
          data={data}
          mode="trace"
          attempt={attempt}
          size={380}
          onDone={() => setFinished(true)}
        />
      ) : (
        <Placeholder error={error} />
      )}
      <div className="step-actions">
        <button className="btn ghost" onClick={() => { setFinished(false); setAttempt((a) => a + 1); }}>
          Ещё раз
        </button>
        <button className="btn primary" onClick={onNext} disabled={!finished}>
          {finished ? 'Дальше — по памяти' : 'Закончи обводку'}
        </button>
      </div>
      <Speakerish char={h.c} voice={voice} />
    </div>
  );
}

function RecallStep({
  h,
  voice,
  phase,
  onResult,
  onNext,
}: {
  h: Hanzi;
  voice: string | null;
  phase: string;
  onResult: (r: WriteResult) => void;
  onNext: () => void;
}) {
  const { data, error } = useStroke(h.c);
  const [result, setResult] = useState<WriteResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const tone = toneOf(syllables(h.py)[0] ?? '');

  const handle = (r: WriteResult) => {
    if (result) return;
    setResult(r);
    onResult(r);
  };

  const verdict = result ? gradeWriting(result.mistakes, result.hintUsed, result.revealed) : null;

  return (
    <div className="step two-col">
      <div className="col-left">
        <span className={`step-tag ${phase === 'warmup' ? 'review' : ''}`}>
          {phase === 'warmup' ? 'Повторение' : 'Напиши по памяти'}
        </span>
        <p className="prompt-line big">
          <b className={`pinyin tone-${tone}`}>{h.py}</b>
        </p>
        <p className="prompt-gloss">{maskChar(gloss(h), h.c)}</p>
        {data ? (
          <Writer char={h.c} data={data} mode="quiz" attempt={attempt} size={380} onDone={handle} />
        ) : (
          <Placeholder error={error} />
        )}
      </div>

      <div className="col-right">
        {result ? (
          <div className={`verdict v${verdict}`}>
            <div className="verdict-head">
              <span className="big-char small">{h.c}</span>
              <div>
                <strong>{verdictText(verdict!)}</strong>
                <p className="note">
                  {result.revealed
                    ? 'Показан ответ — вернётся ещё раз в этой сессии.'
                    : `Ошибок: ${result.mistakes}${result.hintUsed ? ', с подсказкой' : ''}`}
                </p>
              </div>
            </div>
            <CharDetails h={h} voiceURI={voice} compact />
            <div className="step-actions">
              <button className="btn ghost" onClick={() => { setResult(null); setAttempt((a) => a + 1); }}>
                Написать ещё раз
              </button>
              <button className="btn primary" onClick={onNext}>
                Дальше
              </button>
            </div>
          </div>
        ) : (
          <div className="waiting">
            <p className="note">
              Пиши мышью или трекпадом прямо в клетке. Порядок черт проверяется: неверная черта не
              засчитается.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function verdictText(q: number): string {
  if (q >= 5) return 'Идеально';
  if (q === 4) return 'Хорошо';
  if (q === 3) return 'Со скрипом';
  if (q === 2) return 'Неуверенно';
  return 'Ещё не выучено';
}

function QuizStep({
  q,
  voice,
  onAnswer,
  onNext,
}: {
  q: import('../lib/session').QuizQuestion;
  voice: string | null;
  onAnswer: (ok: boolean) => void;
  onNext: () => void;
}) {
  const target = BY_CHAR.get(q.target)!;
  const [picked, setPicked] = useState<string | null>(null);
  const correct = q.type === 'char2meaning' ? gloss(target) : target.c;

  useEffect(() => {
    if (q.type === 'audio2char' && ttsSupported) speak(target.c, { voiceURI: voice });
  }, [q.target, q.type, voice, target.c]);

  const choose = (opt: string) => {
    if (picked) return;
    setPicked(opt);
    onAnswer(opt === correct);
  };

  const prompt = useMemo(() => {
    if (q.type === 'meaning2char') return <p className="quiz-prompt text">{maskChar(gloss(target), target.c)}</p>;
    if (q.type === 'char2meaning') return <p className="quiz-prompt char">{target.c}</p>;
    return (
      <button className="quiz-audio" onClick={() => speak(target.c, { voiceURI: voice })}>
        🔊 Прослушать ещё раз
      </button>
    );
  }, [q.type, target, voice]);

  const title = {
    meaning2char: 'Значение → иероглиф',
    char2meaning: 'Иероглиф → значение',
    audio2char: 'На слух → иероглиф',
  }[q.type];

  return (
    <div className="step centered quiz">
      <span className="step-tag">{title}</span>
      {prompt}
      <div className={`options ${q.type === 'char2meaning' ? 'text-options' : 'char-options'}`}>
        {q.options.map((opt) => {
          const isRight = opt === correct;
          const cls = !picked ? '' : isRight ? 'right' : opt === picked ? 'wrong' : 'dim';
          return (
            <button key={opt} className={`option ${cls}`} onClick={() => choose(opt)} disabled={Boolean(picked)}>
              {opt}
            </button>
          );
        })}
      </div>
      {picked && (
        <div className="quiz-after">
          <p>
            <b className="pinyin">{target.py}</b> — {gloss(target)}
          </p>
          <button className="btn primary" onClick={onNext}>
            Дальше
          </button>
        </div>
      )}
    </div>
  );
}

function Speakerish({ char, voice }: { char: string; voice: string | null }) {
  if (!ttsSupported) return null;
  return (
    <button className="btn ghost sm" onClick={() => speak(char, { voiceURI: voice })}>
      🔊 Произношение
    </button>
  );
}

function Placeholder({ error }: { error: string | null }) {
  return (
    <div className="writer-placeholder">
      {error ? <span className="miss">Не удалось загрузить черты: {error}</span> : <span>Загружаю черты…</span>}
    </div>
  );
}

function Summary({
  tally,
  minutes,
  xpNow,
  streak,
  onExit,
}: {
  tally: Tally;
  minutes: number;
  xpNow: number;
  streak: number;
  onExit: () => void;
}) {
  const total = tally.correct + tally.wrong;
  const acc = total ? Math.round((tally.correct / total) * 100) : 0;
  return (
    <div className="panel summary">
      <h2>Сессия закончена</h2>
      <div className="summary-grid">
        <Stat label="Новых иероглифов" value={tally.learned} />
        <Stat label="Повторений" value={tally.reviewed} />
        <Stat label="Точность" value={`${acc}%`} />
        <Stat label="Минут" value={minutes} />
        <Stat label="Очков за сессию" value={`+${xpNow - tally.xpStart}`} />
        <Stat label="Streak" value={`${streak} 🔥`} />
      </div>
      <button className="btn primary wide" onClick={onExit}>
        На главную
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
