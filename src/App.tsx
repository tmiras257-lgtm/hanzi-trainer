import { useEffect, useState } from 'react';
import { useAppState, CHARACTERS } from './lib/store';
import { levelFromXp } from './lib/format';
import Dashboard from './components/Dashboard';
import SessionView from './components/SessionView';
import Library from './components/Library';
import Settings from './components/Settings';
import type { SessionLength } from './lib/types';

type Tab = 'home' | 'session' | 'library' | 'settings';

export default function App() {
  const { state, actions } = useAppState();
  const [tab, setTab] = useState<Tab>('home');
  const [focusChar, setFocusChar] = useState<string | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  }, []);

  if (!state) {
    return (
      <div className="boot">
        <div className="boot-char">写</div>
        <p>Загружаю прогресс…</p>
      </div>
    );
  }

  const { level } = levelFromXp(state.profile.xp);

  return (
    <div className="app">
      <nav className="topbar">
        <div className="brand">
          <span className="brand-char">写</span>
          <span className="brand-name">Ханьцзы</span>
        </div>
        {tab !== 'session' && (
          <div className="tabs">
            <TabBtn on={tab === 'home'} onClick={() => setTab('home')}>
              Главная
            </TabBtn>
            <TabBtn on={tab === 'library'} onClick={() => setTab('library')}>
              Иероглифы
            </TabBtn>
            <TabBtn on={tab === 'settings'} onClick={() => setTab('settings')}>
              Настройки
            </TabBtn>
          </div>
        )}
        <div className="topstats">
          <span className="badge">🔥 {state.profile.streak}</span>
          <span className="badge">Ур. {level}</span>
          <span className="badge">
            {Object.keys(state.cards).length}/{CHARACTERS.length}
          </span>
        </div>
      </nav>

      <main className="content">
        {tab === 'home' && (
          <Dashboard
            state={state}
            onStart={() => setTab('session')}
            onSetLength={(m: SessionLength) => actions.setProfile({ sessionMinutes: m })}
            onOpenChar={(c) => {
              setFocusChar(c);
              setTab('library');
            }}
          />
        )}
        {tab === 'session' && <SessionView state={state} actions={actions} onExit={() => setTab('home')} />}
        {tab === 'library' && (
          <Library state={state} focus={focusChar} onFocus={setFocusChar} onForget={actions.forget} />
        )}
        {tab === 'settings' && (
          <Settings
            state={state}
            onPatch={actions.setProfile}
            onReplace={actions.replaceAll}
            onReset={actions.reset}
          />
        )}
      </main>
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`tab ${on ? 'on' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
