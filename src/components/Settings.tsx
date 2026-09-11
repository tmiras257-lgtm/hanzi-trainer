import { useEffect, useState } from 'react';
import type { AppState, DrillToggles, Profile, SessionLength } from '../lib/types';
import { DRILL_NAMES, DRILL_BLURBS, type DrillKind } from '../lib/drill';
import { exportState, importState } from '../lib/db';
import { onVoicesReady, chineseVoices, speak, voiceStatus, VOICE_HELP } from '../lib/speech';
import { micAvailable } from '../lib/pitch';
import { VoiceNotice } from './Speaker';

interface Props {
  state: AppState;
  onPatch: (patch: Partial<Profile>) => void;
  onReplace: (next: AppState) => void;
  onReset: () => void;
}

const LENGTHS: SessionLength[] = [10, 20, 30];

export default function Settings({ state, onPatch, onReplace, onReset }: Props) {
  const { profile } = state;
  const [voices, setVoices] = useState(() => chineseVoices());
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => onVoicesReady(() => setVoices(chineseVoices())), []);

  const toggle = (key: DrillKind) => {
    const next: DrillToggles = { ...profile.drills, [key]: !profile.drills[key] };
    // Never let every drill be switched off — a session would have nothing to show.
    if (!Object.values(next).some(Boolean)) return;
    onPatch({ drills: next });
  };

  return (
    <div className="stack">
      <div>
        <h1>Настройки</h1>
        <p className="lede">Всё хранится только в этом браузере. Ни аккаунта, ни сервера.</p>
      </div>

      <section className="card">
        <h2>Упражнения</h2>
        {(Object.keys(DRILL_NAMES) as DrillKind[]).map((k) => (
          <label key={k} className="toggle">
            <input type="checkbox" checked={profile.drills[k]} onChange={() => toggle(k)} />
            <span>
              <span className="t">{DRILL_NAMES[k]}</span>
              <br />
              <span className="d">{DRILL_BLURBS[k]}</span>
              {k === 'sayTone' && !micAvailable() && (
                <>
                  <br />
                  <span className="d" style={{ color: 'var(--bad)' }}>Микрофон в этом браузере недоступен.</span>
                </>
              )}
            </span>
          </label>
        ))}
      </section>

      <section className="card">
        <h2>Занятие</h2>
        <div className="field">
          <label htmlFor="len">Длительность</label>
          <select
            id="len"
            value={profile.sessionMinutes}
            onChange={(e) => onPatch({ sessionMinutes: Number(e.target.value) as SessionLength })}
          >
            {LENGTHS.map((m) => (
              <option key={m} value={m}>{m} минут</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="cap">
            Новых слогов в день: {profile.dailyNewCap === null ? 'по длительности' : profile.dailyNewCap}
          </label>
          <input
            id="cap"
            type="range"
            min={0}
            max={20}
            value={profile.dailyNewCap ?? 20}
            onChange={(e) => {
              const v = Number(e.target.value);
              onPatch({ dailyNewCap: v >= 20 ? null : v });
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="strict">
            Строгость оценки голоса: {Math.round(profile.sayStrictness * 100)}%
          </label>
          <input
            id="strict"
            type="range"
            min={20}
            max={90}
            value={Math.round(profile.sayStrictness * 100)}
            onChange={(e) => onPatch({ sayStrictness: Number(e.target.value) / 100 })}
          />
          <span className="tiny">
            Насколько уверенно контур должен совпасть с эталоном, чтобы попытка засчиталась.
          </span>
        </div>
      </section>

      <section className="card">
        <h2>Голос</h2>
        <VoiceNotice />
        {voices.length > 0 ? (
          <>
            <div className="field">
              <label htmlFor="voice">Китайский голос</label>
              <select
                id="voice"
                value={profile.ttsVoice ?? ''}
                onChange={(e) => onPatch({ ttsVoice: e.target.value || null })}
              >
                <option value="">Выбрать автоматически</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rate">Скорость: {profile.ttsRate.toFixed(2)}×</label>
              <input
                id="rate"
                type="range"
                min={50}
                max={110}
                value={Math.round(profile.ttsRate * 100)}
                onChange={(e) => onPatch({ ttsRate: Number(e.target.value) / 100 })}
              />
            </div>
            <button className="btn sm" onClick={() => speak('你好，我们开始学习声调', { voiceURI: profile.ttsVoice, rate: profile.ttsRate })}>
              Проверить голос
            </button>
          </>
        ) : (
          <p className="subtle">{VOICE_HELP[voiceStatus()]}</p>
        )}
      </section>

      <section className="card">
        <h2>Прогресс</h2>
        <div className="row">
          <button className="btn sm" onClick={() => exportState(state)}>Выгрузить в файл</button>
          <label className="btn sm" style={{ cursor: 'pointer' }}>
            Загрузить из файла
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) onReplace(await importState(file));
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="tiny" style={{ marginTop: '.7rem' }}>
          Карточки из прежней версии тренажёра письма перенесены как карточки чтения: интервалы
          повторений сохранились, рисование черт больше не требуется.
        </p>
        <div className="row" style={{ marginTop: '.7rem' }}>
          {confirmReset ? (
            <>
              <button className="btn sm" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }} onClick={onReset}>
                Да, стереть всё
              </button>
              <button className="btn sm ghost" onClick={() => setConfirmReset(false)}>Отмена</button>
            </>
          ) : (
            <button className="btn sm ghost" onClick={() => setConfirmReset(true)}>Сбросить прогресс</button>
          )}
        </div>
      </section>
    </div>
  );
}
