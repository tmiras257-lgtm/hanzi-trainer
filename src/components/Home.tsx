import { useMemo } from 'react';
import type { AppState } from '../lib/types';
import { dueCards, maturity } from '../lib/srs';
import { attemptQuota, newQuota, pickNewSyllables, DRILL_NAMES, type DrillKind } from '../lib/drill';
import { TONE_NAMES, TONE_CONTOUR, type Tone } from '../lib/pinyin';
import { levelFromXp } from '../lib/format';
import { today, addDays } from '../lib/date';
import ToneStaff from './ToneStaff';
import { VoiceNotice } from './Speaker';

interface Props {
  state: AppState;
  onStart: () => void;
}

export default function Home({ state, onStart }: Props) {
  const { profile } = state;
  const due = useMemo(() => dueCards(state.cards), [state.cards]);
  const fresh = useMemo(
    () => pickNewSyllables(state, newQuota(profile.sessionMinutes, profile.dailyNewCap)),
    [state, profile.sessionMinutes, profile.dailyNewCap],
  );
  const { level, into, span } = levelFromXp(profile.xp);
  const enabled = (Object.keys(profile.drills) as DrillKind[]).filter((k) => profile.drills[k]);

  const counts = useMemo(() => {
    const all = Object.values(state.cards);
    return {
      total: all.length,
      mature: all.filter((c) => maturity(c) === 'mature').length,
      young: all.filter((c) => maturity(c) === 'young').length,
      learning: all.filter((c) => maturity(c) === 'learning' || maturity(c) === 'new').length,
    };
  }, [state.cards]);

  const earAccuracy = useMemo(() => {
    const all = Object.values(state.cards);
    const ok = all.reduce((s, c) => s + c.earOk, 0);
    const total = all.reduce((s, c) => s + c.earTotal, 0);
    return total ? Math.round((ok / total) * 100) : null;
  }, [state.cards]);

  const sayAccuracy = useMemo(() => {
    const all = Object.values(state.cards);
    const ok = all.reduce((s, c) => s + c.sayOk, 0);
    const total = all.reduce((s, c) => s + c.sayTotal, 0);
    return total ? Math.round((ok / total) * 100) : null;
  }, [state.cards]);

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Мандарин · тоны и пиньинь</p>
        <h1>{greeting(due.length, fresh.length)}</h1>
        <p className="lede">
          {due.length
            ? `${due.length} ${plural(due.length, 'повторение', 'повторения', 'повторений')} готово`
            : 'Повторений на сегодня нет'}
          {fresh.length ? ` · ${fresh.length} ${plural(fresh.length, 'новый слог', 'новых слога', 'новых слогов')}` : ''}
          {' · '}до {attemptQuota(profile.sessionMinutes)} ответов за {profile.sessionMinutes} мин
        </p>
        <button className="btn primary big" onClick={onStart}>Начать занятие</button>
      </div>

      <VoiceNotice />

      <section className="card">
        <div className="row between" style={{ marginBottom: '.9rem' }}>
          <h2 style={{ margin: 0 }}>Четыре тона</h2>
          <span className="tiny">контур высоты голоса по пятиуровневой шкале</span>
        </div>
        <div className="tone-grid">
          {([1, 2, 3, 4] as Tone[]).map((t) => (
            <div key={t} className={`tone-btn tone-${t}`} style={{ cursor: 'default' }}>
              <ToneStaff size="glyph" tone={t} solo label={`Тон ${t}: ${TONE_NAMES[t]}`} />
              <span className="n">{t} · {TONE_CONTOUR[t]}</span>
              <span className="name">{TONE_NAMES[t]}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid three">
        <div className="card stat">
          <span className="v">{profile.streak}</span>
          <span className="k">дней подряд · рекорд {profile.bestStreak}</span>
        </div>
        <div className="card stat">
          <span className="v">{level}</span>
          <span className="k">уровень · {into}/{span} XP</span>
        </div>
        <div className="card stat">
          <span className="v">{counts.total}</span>
          <span className="k">карточек в колоде</span>
        </div>
      </div>

      <div className="grid two">
        <section className="card">
          <h3>Точность</h3>
          <Bar label="На слух" value={earAccuracy} tone={1} />
          <Bar label="Голосом" value={sayAccuracy} tone={2} />
          <p className="tiny" style={{ marginTop: '.6rem', marginBottom: 0 }}>
            «Голосом» считает микрофон по контуру высоты — не по распознаванию слов.
          </p>
        </section>

        <section className="card">
          <h3>Колода</h3>
          <Bar label="Зрелые" value={pct(counts.mature, counts.total)} tone={2} />
          <Bar label="Молодые" value={pct(counts.young, counts.total)} tone={3} />
          <Bar label="В работе" value={pct(counts.learning, counts.total)} tone={4} />
        </section>
      </div>

      <section className="card">
        <h3>Ближайшая неделя</h3>
        <Forecast cards={state.cards} />
      </section>

      <p className="tiny">
        Включены упражнения: {enabled.map((k) => DRILL_NAMES[k]).join(' · ') || '—'}
      </p>
    </div>
  );
}

function pct(part: number, total: number): number | null {
  return total ? Math.round((part / total) * 100) : null;
}

function Bar({ label, value, tone }: { label: string; value: number | null; tone: Tone }) {
  return (
    <div className={`bar-row tone-${tone}`}>
      <span className="tiny">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${value ?? 0}%` }} />
      </div>
      <span className="bar-val">{value === null ? '—' : `${value}%`}</span>
    </div>
  );
}

function Forecast({ cards }: { cards: AppState['cards'] }) {
  const days = useMemo(() => {
    const start = today();
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      const n = Object.values(cards).filter((c) => (i === 0 ? c.due <= day : c.due === day)).length;
      return { day, n };
    });
  }, [cards]);
  const max = Math.max(1, ...days.map((d) => d.n));

  return (
    <div style={{ display: 'grid', gap: '.35rem' }}>
      {days.map((d, i) => (
        <div key={d.day} className="bar-row tone-1">
          <span className="tiny num">{i === 0 ? 'сегодня' : d.day.slice(5)}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(d.n / max) * 100}%` }} />
          </div>
          <span className="bar-val">{d.n}</span>
        </div>
      ))}
    </div>
  );
}

function greeting(due: number, fresh: number): string {
  if (due === 0 && fresh === 0) return 'Всё повторено';
  if (due === 0) return 'Пора за новые слоги';
  if (due > 40) return 'Накопилось повторений';
  return 'Готов слушать';
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
