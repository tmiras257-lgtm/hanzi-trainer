import { useMemo } from 'react';
import type { AppState, SessionLength } from '../lib/types';
import { CHARACTERS } from '../lib/store';
import { dueCards, maturity, retention } from '../lib/srs';
import { pickNew } from '../lib/selection';
import { PLANS } from '../lib/session';
import { addDays, plural, ruDate, today } from '../lib/date';
import { levelFromXp, strokesLabel } from '../lib/format';

interface Props {
  state: AppState;
  onStart: () => void;
  onSetLength: (m: SessionLength) => void;
  onOpenChar: (c: string) => void;
}

export default function Dashboard({ state, onStart, onSetLength, onOpenChar }: Props) {
  const day = today();
  const cards = state.cards;
  const due = useMemo(() => dueCards(cards, day), [cards, day]);
  const plan = PLANS[state.profile.sessionMinutes];
  const newCount = state.profile.dailyNewCap ?? plan.newCount;
  const upNext = useMemo(() => pickNew(CHARACTERS, cards, newCount), [cards, newCount]);
  const { level, into, span } = levelFromXp(state.profile.xp);

  const learned = Object.keys(cards).length;
  const buckets = useMemo(() => {
    const b = { new: 0, learning: 0, young: 0, mature: 0 };
    for (const c of Object.values(cards)) b[maturity(c)] += 1;
    return b;
  }, [cards]);

  const avgRetention = useMemo(() => {
    const vals = Object.values(cards).map(retention).filter((v): v is number => v !== null);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
  }, [cards]);

  // Day 0 carries everything overdue; later days show only what falls due exactly then.
  const forecast = useMemo(() => {
    const all = Object.values(cards);
    return Array.from({ length: 7 }, (_, k) => {
      const d = addDays(day, k);
      return { day: d, n: all.filter((c) => (k === 0 ? c.due <= d : c.due === d)).length };
    });
  }, [cards, day]);

  const reviewsToday = Math.min(due.length, plan.reviewCap);

  return (
    <div className="dashboard">
      <section className="hero panel">
        <div className="hero-main">
          <h1>Сегодня</h1>
          <p className="hero-line">
            <b>{reviewsToday}</b> {plural(reviewsToday, 'иероглиф к повторению', 'иероглифа к повторению', 'иероглифов к повторению')}
            {' · '}
            <b>{upNext.length}</b> {plural(upNext.length, 'новый', 'новых', 'новых')}
          </p>
          {due.length > plan.reviewCap && (
            <p className="note">
              Всего созрело {due.length}; за сессию возьмём {plan.reviewCap}, остальное подтянется завтра.
            </p>
          )}

          <div className="length-picker">
            <span className="label">Длина сессии</span>
            {([30, 45, 60] as SessionLength[]).map((m) => (
              <button
                key={m}
                className={`pill ${state.profile.sessionMinutes === m ? 'on' : ''}`}
                onClick={() => onSetLength(m)}
              >
                {m} мин
              </button>
            ))}
          </div>

          <button className="btn primary big" onClick={onStart}>
            Начать занятие
          </button>
        </div>

        <div className="hero-side">
          <div className="level-block">
            <div className="level-row">
              <span className="level-num">Ур. {level}</span>
              <span className="note">
                {into} / {span} XP
              </span>
            </div>
            <div className="progress">
              <div style={{ width: `${(into / span) * 100}%` }} />
            </div>
          </div>
          <div className="mini-stats">
            <Mini value={`${state.profile.streak} 🔥`} label={`streak · рекорд ${state.profile.bestStreak}`} />
            <Mini value={learned} label={`из ${CHARACTERS.length} иероглифов`} />
            <Mini value={avgRetention === null ? '—' : `${avgRetention}%`} label="среднее удержание" />
            <Mini value={state.profile.xp} label="всего XP" />
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2>Следующие иероглифы</h2>
          <p className="note">
            Подобраны по частотности, числу черт и уже знакомым компонентам — не по порядку HSK.
          </p>
          <ul className="upnext">
            {upNext.map(({ hanzi, knownComps }) => (
              <li key={hanzi.c}>
                <button className="upnext-char" onClick={() => onOpenChar(hanzi.c)}>
                  {hanzi.c}
                </button>
                <div className="upnext-body">
                  <div className="upnext-top">
                    <b className="pinyin">{hanzi.py}</b>
                    <span className="note">#{hanzi.rank} · {strokesLabel(hanzi.strokes)}</span>
                  </div>
                  <div className="upnext-gloss">{hanzi.ru || hanzi.en}</div>
                  {knownComps.length > 0 && (
                    <div className="note">знакомые части: {knownComps.join(' ')}</div>
                  )}
                </div>
              </li>
            ))}
            {upNext.length === 0 && <li className="note">Набор из {CHARACTERS.length} иероглифов пройден целиком.</li>}
          </ul>
        </section>

        <section className="panel">
          <h2>Состояние колоды</h2>
          <div className="buckets">
            <Bucket label="Только введены" value={buckets.new} tone="new" total={learned} />
            <Bucket label="В работе (&lt; 3 дн.)" value={buckets.learning} tone="learning" total={learned} />
            <Bucket label="Молодые (&lt; 3 нед.)" value={buckets.young} tone="young" total={learned} />
            <Bucket label="Зрелые" value={buckets.mature} tone="mature" total={learned} />
          </div>

          <h3>Повторения на неделю</h3>
          <div className="forecast">
            {forecast.map((f, idx) => {
              const max = Math.max(1, ...forecast.map((x) => x.n));
              return (
                <div key={f.day} className="fc-col" title={`${f.n} к повторению`}>
                  <div className="fc-bar" style={{ height: `${(f.n / max) * 100}%` }} />
                  <span className="fc-label">{idx === 0 ? 'сегодня' : ruDate(f.day)}</span>
                  <span className="fc-n">{f.n}</span>
                </div>
              );
            })}
          </div>

          <h3>Активность</h3>
          <Heatmap state={state} />
        </section>
      </div>
    </div>
  );
}

function Mini({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="mini">
      <div className="mini-value">{value}</div>
      <div className="mini-label">{label}</div>
    </div>
  );
}

function Bucket({ label, value, tone, total }: { label: string; value: number; tone: string; total: number }) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div className="bucket">
      <div className="bucket-head">
        <span dangerouslySetInnerHTML={{ __html: label }} />
        <b>{value}</b>
      </div>
      <div className={`bucket-bar ${tone}`}>
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Heatmap({ state }: { state: AppState }) {
  const map = new Map(state.log.map((l) => [l.day, l]));
  const end = today();
  const days: string[] = [];
  for (let i = 83; i >= 0; i--) days.push(addDays(end, -i));
  const max = Math.max(1, ...state.log.map((l) => l.reviews + l.learned));

  return (
    <div className="heatmap">
      {days.map((d) => {
        const l = map.get(d);
        const n = l ? l.reviews + l.learned : 0;
        const step = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
        return <span key={d} className={`hm l${step}`} title={`${ruDate(d)}: ${n}`} />;
      })}
    </div>
  );
}
