import { useMemo, useState } from 'react';
import type { AppState } from '../lib/types';
import { cardId } from '../lib/types';
import { MINIMAL_PAIRS, toneRow, SYLLABLES } from '../lib/syllables';
import { TONE_NAMES, type Tone } from '../lib/pinyin';
import { maturity } from '../lib/srs';
import Speaker from './Speaker';
import ToneStaff from './ToneStaff';

interface Props {
  state: AppState;
}

/**
 * A reference table of minimal pairs: one row per base syllable, one column per
 * tone. Rows where a tone does not exist stay empty rather than being filled
 * with a near-miss, because a gap is information too.
 */
export default function Library({ state }: Props) {
  const [query, setQuery] = useState('');
  const { profile } = state;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = MINIMAL_PAIRS.filter((p) => p.variants.length >= 2);
    if (!q) return source.slice(0, 60);
    return source
      .filter(
        (p) =>
          p.base.includes(q) ||
          p.variants.some((v) => v.marked.includes(q) || v.chars.some((c) => c.includes(q))),
      )
      .slice(0, 60);
  }, [query]);

  const known = (id: string) => {
    const card = state.cards[cardId('tone', id)];
    return card ? maturity(card) : null;
  };

  return (
    <div className="stack">
      <div>
        <h1>Минимальные пары</h1>
        <p className="lede">
          Слоги, которые отличаются только тоном — {MINIMAL_PAIRS.length} основ из {SYLLABLES.length} слогов.
          Пустая клетка значит, что такого чтения в словаре нет.
        </p>
        <input
          className="field"
          style={{ padding: '.55rem .7rem', borderRadius: 'var(--r-md)', border: '1px solid var(--rule)', background: 'var(--surface)', maxWidth: '18rem' }}
          placeholder="Поиск: ma, mǎ или 马"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск по слогам"
        />
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '34rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '.4rem .5rem', fontSize: '.72rem', color: 'var(--ink-faint)', fontWeight: 500 }}>
                основа
              </th>
              {([1, 2, 3, 4] as Tone[]).map((t) => (
                <th key={t} className={`tone-${t}`} style={{ padding: '.4rem .5rem', fontSize: '.72rem', fontWeight: 500 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.15rem' }}>
                    <ToneStaff size="glyph" tone={t} solo label={`Тон ${t}: ${TONE_NAMES[t]}`} />
                    <span style={{ color: 'var(--tone)', fontFamily: 'var(--mono)' }}>{t}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ base }) => (
              <tr key={base} style={{ borderTop: '1px solid var(--rule-soft)' }}>
                <td className="num" style={{ padding: '.5rem', color: 'var(--ink-muted)', fontSize: '.82rem' }}>{base}</td>
                {toneRow(base).map((s, i) => (
                  <td key={i} style={{ padding: '.35rem .5rem', textAlign: 'center' }}>
                    {s ? (
                      <div className={`tone-${s.tone}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.1rem' }}>
                        <span className="py" style={{ color: 'var(--tone)', fontWeight: 600 }}>{s.marked}</span>
                        <span className="zh" style={{ fontSize: '1.15rem' }}>{s.chars[0]}</span>
                        <span className="tiny" style={{ opacity: known(s.id) ? 1 : .35 }}>
                          {known(s.id) ? '●' : '○'}
                        </span>
                        <Speaker
                          text={s.chars[0]}
                          voiceURI={profile.ttsVoice}
                          rate={profile.ttsRate}
                          label=""
                          className="ghost sm"
                        />
                      </div>
                    ) : (
                      <span style={{ color: 'var(--ink-faint)' }}>—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="tiny">● — слог уже в колоде, ○ — ещё не встречался.</p>
    </div>
  );
}
