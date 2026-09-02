import { useEffect, useRef, useState } from 'react';
import type { AppState, Profile } from '../lib/types';
import { chineseVoices, onVoicesReady, speak, ttsSupported, asrSupported } from '../lib/speech';
import { exportState, importState } from '../lib/db';
import { prefetchAll } from '../lib/strokes';

interface Props {
  state: AppState;
  onPatch: (p: Partial<Profile>) => void;
  onReplace: (s: AppState) => void;
  onReset: () => void;
}

export default function Settings({ state, onPatch, onReplace, onReset }: Props) {
  const [voices, setVoices] = useState(() => chineseVoices());
  const [offline, setOffline] = useState<'idle' | 'busy' | 'done'>('idle');
  const [confirmReset, setConfirmReset] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => onVoicesReady(() => setVoices(chineseVoices())), []);

  return (
    <div className="settings panel">
      <h2>Настройки</h2>

      <section>
        <h3>Новые иероглифы в день</h3>
        <p className="note">
          По умолчанию зависит от длины сессии (30 мин → 3, 45 → 5, 60 → 7). Можно зафиксировать своё число.
        </p>
        <div className="row">
          <button
            className={`pill ${state.profile.dailyNewCap === null ? 'on' : ''}`}
            onClick={() => onPatch({ dailyNewCap: null })}
          >
            Авто
          </button>
          {[2, 3, 5, 7, 10].map((n) => (
            <button
              key={n}
              className={`pill ${state.profile.dailyNewCap === n ? 'on' : ''}`}
              onClick={() => onPatch({ dailyNewCap: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Озвучка</h3>
        {!ttsSupported ? (
          <p className="note miss">Браузер не поддерживает синтез речи.</p>
        ) : voices.length === 0 ? (
          <p className="note miss">
            Китайские голоса не найдены в системе. На macOS их можно добавить в Системных настройках →
            Универсальный доступ → Устная речь → Системный голос → Управление голосами (Chinese).
          </p>
        ) : (
          <div className="row">
            <select
              className="pill select"
              value={state.profile.ttsVoice ?? ''}
              onChange={(e) => onPatch({ ttsVoice: e.target.value || null })}
            >
              <option value="">Голос по умолчанию</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <button className="btn ghost sm" onClick={() => speak('你好，我们开始学习汉字', { voiceURI: state.profile.ttsVoice })}>
              Проверить
            </button>
          </div>
        )}
        <p className="note">
          Распознавание речи: {asrSupported ? 'доступно' : 'недоступно в этом браузере'}. Оно работает
          через сервис браузера и требует интернета; тоны оно не разбирает.
        </p>
      </section>

      <section>
        <h3>Работа офлайн</h3>
        <p className="note">
          Приложение целиком лежит в браузере. Кнопка ниже подтягивает данные о чертах всех {' '}
          иероглифов набора, чтобы занятия работали без интернета.
        </p>
        <button
          className="btn ghost"
          disabled={offline === 'busy'}
          onClick={async () => {
            setOffline('busy');
            await prefetchAll();
            setOffline('done');
          }}
        >
          {offline === 'busy' ? 'Загружаю…' : offline === 'done' ? 'Готово ✓' : 'Скачать все черты'}
        </button>
      </section>

      <section>
        <h3>Прогресс</h3>
        <p className="note">
          Хранится в IndexedDB этого браузера с дублем в localStorage. Бэкап стоит делать перед сменой
          браузера или чисткой данных сайта.
        </p>
        <div className="row">
          <button className="btn ghost" onClick={() => exportState(state)}>
            Скачать бэкап
          </button>
          <button className="btn ghost" onClick={() => file.current?.click()}>
            Загрузить бэкап
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                onReplace(await importState(f));
              } catch {
                alert('Не удалось прочитать файл.');
              }
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <section className="danger">
        <h3>Сброс</h3>
        {confirmReset ? (
          <div className="row">
            <span className="note miss">Весь прогресс, streak и расписание повторений будут стёрты.</span>
            <button className="btn danger" onClick={onReset}>
              Да, стереть
            </button>
            <button className="btn ghost" onClick={() => setConfirmReset(false)}>
              Отмена
            </button>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => setConfirmReset(true)}>
            Начать с нуля
          </button>
        )}
      </section>
    </div>
  );
}
