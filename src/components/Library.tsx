import { useMemo, useState } from 'react';
import type { AppState, Hanzi } from '../lib/types';
import { CHARACTERS } from '../lib/store';
import { maturity, retention } from '../lib/srs';
import { gloss, hskLabel, toneless } from '../lib/format';
import { ruDate, today } from '../lib/date';
import { useStroke } from '../lib/useStroke';
import Writer from './Writer';
import CharDetails from './CharDetails';
import Pronounce from './Pronounce';

type Filter = 'all' | 'learned' | 'due' | 'unseen';

interface Props {
  state: AppState;
  focus: string | null;
  onFocus: (c: string | null) => void;
  onForget: (c: string) => void;
}

export default function Library({ state, focus, onFocus, onForget }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [hsk, setHsk] = useState<number | 'any'>('any');
  const day = today();

  const rows = useMemo(() => {
    const q = toneless(query.trim());
    return CHARACTERS.filter((h) => {
      const card = state.cards[h.c];
      if (filter === 'learned' && !card) return false;
      if (filter === 'unseen' && card) return false;
      if (filter === 'due' && !(card && card.due <= day)) return false;
      if (hsk !== 'any' && h.hsk !== hsk) return false;
      if (!q) return true;
      return (
        h.c.includes(q) ||
        toneless(h.py).includes(q) ||
        toneless(h.py).replace(/\s+/g, '').includes(q) ||
        h.en.toLowerCase().includes(q) ||
        h.ru.toLowerCase().includes(q)
      );
    });
  }, [query, filter, hsk, state.cards, day]);

  const selected = focus ? CHARACTERS.find((h) => h.c === focus) ?? null : null;

  return (
    <div className="library">
      <div className="lib-list panel">
        <div className="lib-controls">
          <input
            className="search"
            placeholder="Поиск: иероглиф, пиньинь, значение…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="filters">
            {(
              [
                ['all', 'Все'],
                ['learned', 'Изучаются'],
                ['due', 'К повторению'],
                ['unseen', 'Не начаты'],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <button key={k} className={`pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
            <select className="pill select" value={hsk} onChange={(e) => setHsk(e.target.value === 'any' ? 'any' : Number(e.target.value))}>
              <option value="any">HSK: любой</option>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  HSK {n === 7 ? '7-9' : n}
                </option>
              ))}
            </select>
          </div>
          <p className="note">Найдено: {rows.length}</p>
        </div>

        <div className="lib-rows">
          {rows.map((h) => {
            const card = state.cards[h.c];
            const m = card ? maturity(card) : null;
            return (
              <button
                key={h.c}
                className={`lib-row ${focus === h.c ? 'on' : ''}`}
                onClick={() => onFocus(h.c)}
              >
                <span className={`lib-char ${m ?? 'unseen'}`}>{h.c}</span>
                <span className="lib-mid">
                  <span className="pinyin">{h.py}</span>
                  <span className="lib-gloss">{gloss(h)}</span>
                </span>
                <span className="lib-meta">
                  <span className="note">#{h.rank}</span>
                  {card && <span className={`dot ${m}`} title={`повтор ${ruDate(card.due)}`} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="lib-detail panel">
        {selected ? (
          <Detail h={selected} state={state} onForget={onForget} />
        ) : (
          <p className="note centered-note">Выбери иероглиф слева, чтобы посмотреть карточку, порядок черт и уровень HSK.</p>
        )}
      </div>
    </div>
  );
}

function Detail({ h, state, onForget }: { h: Hanzi; state: AppState; onForget: (c: string) => void }) {
  const { data, error } = useStroke(h.c);
  const card = state.cards[h.c];
  const r = card ? retention(card) : null;

  return (
    <div className="detail-body">
      <div className="detail-writer">
        {data ? <Writer char={h.c} data={data} mode="animate" size={300} /> : <div className="writer-placeholder">{error ?? 'Загружаю…'}</div>}
      </div>
      <div className="detail-info">
        <div className="big-char">{h.c}</div>
        <CharDetails h={h} voiceURI={state.profile.ttsVoice} />
        <Pronounce target={h.c} pinyin={h.py} />

        <div className="card-state">
          <h3>Твой прогресс</h3>
          {card ? (
            <>
              <div className="kv">
                <span>Следующее повторение</span>
                <b>{ruDate(card.due)}</b>
              </div>
              <div className="kv">
                <span>Интервал</span>
                <b>{card.interval} дн.</b>
              </div>
              <div className="kv">
                <span>Лёгкость (EF)</span>
                <b>{card.ef.toFixed(2)}</b>
              </div>
              <div className="kv">
                <span>Написание</span>
                <b>
                  {card.writeOk} / {card.writeTotal}
                </b>
              </div>
              <div className="kv">
                <span>Квиз</span>
                <b>
                  {card.quizOk} / {card.quizTotal}
                </b>
              </div>
              <div className="kv">
                <span>Удержание</span>
                <b>{r === null ? '—' : `${Math.round(r * 100)}%`}</b>
              </div>
              <div className="kv">
                <span>Срывов</span>
                <b>{card.lapses}</b>
              </div>
              <button className="btn ghost sm" onClick={() => onForget(h.c)}>
                Убрать из колоды
              </button>
            </>
          ) : (
            <p className="note">Ещё не введён. Появится в занятии, когда до него дойдёт очередь ({hskLabel(h)}).</p>
          )}
        </div>
      </div>
    </div>
  );
}
