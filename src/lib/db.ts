import { get, set } from 'idb-keyval';
import type { AppState, Profile } from './types';
import { today } from './date';

const KEY = 'hanzi-trainer-state';
const MIRROR = 'hanzi-trainer-state-mirror';
export const STATE_VERSION = 1;

export function emptyState(): AppState {
  const profile: Profile = {
    xp: 0,
    streak: 0,
    bestStreak: 0,
    lastStudyDay: null,
    sessionMinutes: 45,
    totalReviews: 0,
    totalLearned: 0,
    createdAt: today(),
    ttsVoice: null,
    dailyNewCap: null,
  };
  return { version: STATE_VERSION, profile, cards: {}, log: [] };
}

function migrate(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') return emptyState();
  const base = emptyState();
  const s = raw as Partial<AppState>;
  return {
    version: STATE_VERSION,
    profile: { ...base.profile, ...(s.profile ?? {}) },
    cards: s.cards ?? {},
    log: s.log ?? [],
  };
}

export async function loadState(): Promise<AppState> {
  try {
    const fromIdb = await get<AppState>(KEY);
    if (fromIdb) return migrate(fromIdb);
  } catch {
    /* IndexedDB blocked (private mode, hardened settings) - fall through to the mirror */
  }
  try {
    const raw = localStorage.getItem(MIRROR);
    if (raw) return migrate(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return emptyState();
}

/**
 * Written to both stores on every save. IndexedDB is the real home; the
 * localStorage mirror is a cheap insurance policy against a wiped object store,
 * since losing months of scheduling data to a browser quirk would be unrecoverable.
 */
export async function saveState(state: AppState): Promise<void> {
  const json = JSON.stringify(state);
  try {
    localStorage.setItem(MIRROR, json);
  } catch {
    /* quota - IndexedDB is still authoritative */
  }
  try {
    await set(KEY, state);
  } catch {
    /* ignore */
  }
}

export function exportState(state: AppState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hanzi-progress-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importState(file: File): Promise<AppState> {
  return migrate(JSON.parse(await file.text()));
}
