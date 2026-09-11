import { useEffect, useState } from 'react';
import { useAppState } from './lib/store';
import { levelFromXp } from './lib/format';
import Home from './components/Home';
import Session from './components/Session';
import Library from './components/Library';
import Settings from './components/Settings';
import ToneStaff from './components/ToneStaff';

type Tab = 'home' | 'session' | 'library' | 'settings';

export default function App() {
  const { state, actions } = useAppState();
  const [tab, setTab] = useState<Tab>('home');

  /*
   * Earlier builds registered a cache-first service worker. It outlived its
   * build: a returning browser was served a cached shell pointing at a bundle
   * that no longer exists, and the page came up blank. Nothing here needs to
   * work offline badly enough to justify that, so any leftover worker and its
   * caches are torn down instead of replaced.
   */
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
    }
    if ('caches' in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {});
    }
  }, []);

  if (!state) return <BootSkeleton />;

  const { level } = levelFromXp(state.profile.xp);

  return (
    <div className="app">
      <nav className="topbar">
        <div className="brand">
          <ToneStaff size="glyph" tone={2} solo label="Тоны" />
          <span className="brand-name">Тоны</span>
        </div>

        {tab !== 'session' && (
          <div className="tabs">
            <button className={`tab ${tab === 'home' ? 'on' : ''}`} onClick={() => setTab('home')}>Главная</button>
            <button className={`tab ${tab === 'library' ? 'on' : ''}`} onClick={() => setTab('library')}>Слоги</button>
            <button className={`tab ${tab === 'settings' ? 'on' : ''}`} onClick={() => setTab('settings')}>Настройки</button>
          </div>
        )}

        <div className="topstats" style={tab === 'session' ? { marginLeft: 'auto' } : undefined}>
          <span className="badge">🔥 {state.profile.streak}</span>
          <span className="badge">Ур. {level}</span>
        </div>
      </nav>

      <main className="content">
        {tab === 'home' && <Home state={state} onStart={() => setTab('session')} />}
        {tab === 'session' && (
          <Session
            state={state}
            onAnswer={actions.answer}
            onFinish={actions.finishSession}
            onExit={() => setTab('home')}
          />
        )}
        {tab === 'library' && <Library state={state} />}
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

/**
 * Sized to the real home screen, so when the saved progress arrives nothing
 * moves: same heading block, same button, same card grid, same heights.
 */
function BootSkeleton() {
  return (
    <div className="app">
      <nav className="topbar">
        <div className="brand">
          <ToneStaff size="glyph" tone={2} solo label="Тоны" />
          <span className="brand-name">Тоны</span>
        </div>
        <div className="tabs" aria-hidden="true">
          <span className="sk" style={{ width: 68, height: 30, borderRadius: 6 }} />
          <span className="sk" style={{ width: 58, height: 30, borderRadius: 6 }} />
          <span className="sk" style={{ width: 82, height: 30, borderRadius: 6 }} />
        </div>
        <div className="topstats" aria-hidden="true">
          <span className="sk" style={{ width: 44, height: 22, borderRadius: 999 }} />
          <span className="sk" style={{ width: 52, height: 22, borderRadius: 999 }} />
        </div>
      </nav>

      <main className="content" aria-busy="true" aria-label="Загружаю прогресс">
        <div className="stack">
          <div>
            <span className="sk text" style={{ display: 'block', width: 160, marginBottom: 10 }} />
            <span className="sk" style={{ display: 'block', width: 260, height: 30, marginBottom: 10 }} />
            <span className="sk text" style={{ display: 'block', width: 340, marginBottom: 18 }} />
            <span className="sk" style={{ display: 'block', width: 190, height: 46, borderRadius: 16 }} />
          </div>

          <div className="card">
            <span className="sk text" style={{ display: 'block', width: 120, marginBottom: 14 }} />
            <div className="tone-grid">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className="sk" style={{ height: 92, borderRadius: 10 }} />
              ))}
            </div>
          </div>

          <div className="grid three">
            {[1, 2, 3].map((i) => (
              <span key={i} className="sk" style={{ height: 78, borderRadius: 16 }} />
            ))}
          </div>

          <div className="grid two">
            {[1, 2].map((i) => (
              <span key={i} className="sk" style={{ height: 132, borderRadius: 16 }} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
