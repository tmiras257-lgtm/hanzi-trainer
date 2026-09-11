import { get, set } from 'idb-keyval';
import type { AppState, CardState, DayLog, Profile } from './types';
import { cardId } from './types';
import { today } from './date';

const KEY = 'hanzi-trainer-state';
const MIRROR = 'hanzi-trainer-state-mirror';

/** 1 = the handwriting trainer. 2 = tones and pinyin. */
export const STATE_VERSION = 2;

export function emptyProfile(): Profile {
  return {
    xp: 0,
    streak: 0,
    bestStreak: 0,
    lastStudyDay: null,
    sessionMinutes: 20,
    totalReviews: 0,
    totalLearned: 0,
    createdAt: today(),
    ttsVoice: null,
    ttsRate: 0.8,
    dailyNewCap: null,
    drills: { hearTone: true, minimalPair: true, sayTone: true, readPinyin: true },
    sayStrictness: 0.5,
  };
}

export function emptyState(): AppState {
  return { version: STATE_VERSION, profile: emptyProfile(), cards: {}, log: [] };
}

interface LegacyCard {
  c?: string;
  ef?: number;
  interval?: number;
  reps?: number;
  lapses?: number;
  due?: string;
  introduced?: string;
  history?: number[];
  quizOk?: number;
  quizTotal?: number;
}

/**
 * A version 1 card recorded how well a character was written by hand. Writing
 * is no longer trained here, but the same card also tracked whether the reading
 * was recognised, and that scheduling is still worth something — so each old
 * character becomes a reading card and keeps its interval and its quiz counts.
 */
function liftLegacyCard(raw: LegacyCard, key: string): CardState | null {
  if (!key) return null;
  const day = raw.introduced ?? today();
  return {
    id: cardId('read', key),
    kind: 'read',
    key,
    ef: raw.ef ?? 2.5,
    interval: raw.interval ?? 0,
    reps: raw.reps ?? 0,
    lapses: raw.lapses ?? 0,
    due: raw.due ?? today(),
    introduced: day,
    history: Array.isArray(raw.history) ? raw.history.slice(-20) : [],
    earOk: 0,
    earTotal: 0,
    sayOk: 0,
    sayTotal: 0,
    readOk: raw.quizOk ?? 0,
    readTotal: raw.quizTotal ?? 0,
  };
}

function migrateCards(raw: unknown, version: number): Record<string, CardState> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, CardState> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    if (version >= 2) {
      const card = value as CardState;
      if (card.id && card.kind && card.key) out[card.id] = card;
      continue;
    }
    const lifted = liftLegacyCard(value as LegacyCard, (value as LegacyCard).c ?? key);
    if (lifted) out[lifted.id] = lifted;
  }
  return out;
}

function migrateLog(raw: unknown): DayLog[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Partial<DayLog> => Boolean(l) && typeof l === 'object' && typeof (l as DayLog).day === 'string')
    .map((l) => ({
      day: l.day as string,
      reviews: l.reviews ?? 0,
      learned: l.learned ?? 0,
      xp: l.xp ?? 0,
      saidOk: l.saidOk ?? 0,
      saidTotal: l.saidTotal ?? 0,
    }))
    .slice(-400);
}

function migrate(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') return emptyState();
  const s = raw as Partial<AppState> & { version?: number };
  const base = emptyProfile();
  const incoming = (s.profile ?? {}) as Partial<Profile>;

  // Session lengths changed from 30/45/60 minutes to 10/20/30; anything
  // outside the new set falls back to the default rather than sticking.
  const minutes = incoming.sessionMinutes;
  const sessionMinutes = minutes === 10 || minutes === 20 || minutes === 30 ? minutes : base.sessionMinutes;

  return {
    version: STATE_VERSION,
    profile: {
      ...base,
      ...incoming,
      sessionMinutes,
      drills: { ...base.drills, ...(incoming.drills ?? {}) },
      ttsRate: typeof incoming.ttsRate === 'number' ? incoming.ttsRate : base.ttsRate,
      sayStrictness: typeof incoming.sayStrictness === 'number' ? incoming.sayStrictness : base.sayStrictness,
    },
    cards: migrateCards(s.cards, s.version ?? 1),
    log: migrateLog(s.log),
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
 * localStorage mirror is cheap insurance against a wiped object store, since
 * losing months of scheduling data to a browser quirk would be unrecoverable.
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
  a.download = `tones-progress-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importState(file: File): Promise<AppState> {
  return migrate(JSON.parse(await file.text()));
}
