import { useState } from 'react';
import type { Hanzi } from '../lib/types';
import { gloss, glossLang, hskLabel, strokesLabel, structureName, syllables, toneOf, TONE_NAMES } from '../lib/format';
import Speaker from './Speaker';

interface Props {
  h: Hanzi;
  voiceURI?: string | null;
  compact?: boolean;
  knownComps?: string[];
}

export default function CharDetails({ h, voiceURI, compact, knownComps = [] }: Props) {
  const [showHsk, setShowHsk] = useState(false);
  const tones = syllables(h.py).map(toneOf);

  return (
    <div className={`details ${compact ? 'compact' : ''}`}>
      <div className="details-head">
        <div>
          <div className="reading">
            <span className={`pinyin tone-${tones[0] ?? 0}`}>{h.py}</span>
            <Speaker text={h.c} voiceURI={voiceURI} label="" />
          </div>
          <div className="tone-name">{TONE_NAMES[tones[0] ?? 0]} тон</div>
        </div>
        <div className="details-facts">
          <span className="chip">{strokesLabel(h.strokes)}</span>
          <span className="chip">#{h.rank} по частоте</span>
          {h.radical && <span className="chip">ключ {h.radical}</span>}
        </div>
      </div>

      <p className={`gloss ${glossLang(h)}`}>{gloss(h)}</p>
      {h.ru && <p className="gloss-en">{h.en}</p>}

      {h.alts.length > 0 && (
        <p className="note">
          Другие чтения:{' '}
          {h.alts.map((a, i) => (
            <span key={a.py}>
              {i > 0 && ', '}
              <b>{a.py}</b> — {a.en}
            </span>
          ))}
        </p>
      )}

      {(h.comps.length > 0 || h.hint) && (
        <div className="structure">
          {h.comps.length > 0 && (
            <div className="comps">
              <span className="label">Состав</span>
              {structureName(h.decomp) && <span className="chip">{structureName(h.decomp)}</span>}
              {h.comps.map((c) => (
                <span key={c} className={`comp ${knownComps.includes(c) ? 'known' : ''}`}>
                  {c}
                </span>
              ))}
              {knownComps.length > 0 && <span className="note inline">выделенное уже знакомо</span>}
            </div>
          )}
          {h.hint && <p className="hint">💡 {h.hint}</p>}
        </div>
      )}

      {h.words.length > 0 && (
        <div className="words">
          <span className="label">В словах</span>
          <ul>
            {h.words.map((w) => (
              <li key={w.w}>
                <span className="w">{w.w}</span>
                <span className="wp">{w.p}</span>
                <span className="we">{w.e}</span>
                <Speaker text={w.w} voiceURI={voiceURI} label="" className="tiny" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="hsk-row">
        {showHsk ? (
          <span className="chip hsk">{hskLabel(h)}</span>
        ) : (
          <button className="linklike" onClick={() => setShowHsk(true)}>
            Показать уровень HSK
          </button>
        )}
        <span className="note subtle">HSK здесь только для ориентира — порядок изучения от него не зависит.</span>
      </div>
    </div>
  );
}
