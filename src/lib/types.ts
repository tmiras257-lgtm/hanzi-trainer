export interface CharWord {
  w: string;          // 词 (simplified)
  p: string;          // pinyin
  e: string;          // English gloss
  h: number | null;   // HSK 3.0 level
}

export interface CharAlt {
  py: string;
  en: string;
}

/** One character from the generated dataset. Static, never mutated. */
export interface Hanzi {
  i: number;
  c: string;
  rank: number;              // Jun Da frequency rank (1 = most frequent)
  py: string;
  en: string;
  ru: string;                // empty for characters beyond the hand-glossed head of the list
  strokes: number | null;
  radical: string;
  decomp: string;
  comps: string[];
  hsk: number | null;        // HSK 3.0
  hskOld: number | null;     // HSK 2.0
  hint: string;
  alts: CharAlt[];           // other readings (多音字)
  words: CharWord[];
}

/**
 * What a card trains.
 *  - 'tone'  keyed by toned syllable ("t:ma3"): hearing the tone and producing it.
 *  - 'read'  keyed by character ("r:马"): recognising which reading a character has.
 */
export type CardKind = 'tone' | 'read';

/** Per-item learning state. Persisted. */
export interface CardState {
  id: string;                // "t:ma3" | "r:马"
  kind: CardKind;
  /** Syllable id or character, without the kind prefix. */
  key: string;
  ef: number;                // SM-2 ease factor
  interval: number;          // days
  reps: number;              // successful reps in a row
  lapses: number;
  due: string;               // YYYY-MM-DD
  introduced: string;        // YYYY-MM-DD
  history: number[];         // last grades, newest last
  earOk: number;
  earTotal: number;
  sayOk: number;
  sayTotal: number;
  readOk: number;
  readTotal: number;
}

export interface DayLog {
  day: string;
  reviews: number;
  learned: number;
  xp: number;
  /** Spoken attempts that the pitch tracker accepted as the right contour. */
  saidOk: number;
  saidTotal: number;
}

export type SessionLength = 10 | 20 | 30;

/** Which drills a session may draw from. At least one is always on. */
export interface DrillToggles {
  hearTone: boolean;
  minimalPair: boolean;
  sayTone: boolean;
  readPinyin: boolean;
}

export interface Profile {
  xp: number;
  streak: number;
  bestStreak: number;
  lastStudyDay: string | null;
  sessionMinutes: SessionLength;
  totalReviews: number;
  totalLearned: number;
  createdAt: string;
  ttsVoice: string | null;
  ttsRate: number;
  dailyNewCap: number | null; // null = derive from session length
  drills: DrillToggles;
  /** Tone accuracy needed before a spoken attempt counts as passed, 0..1. */
  sayStrictness: number;
}

export interface AppState {
  version: number;
  profile: Profile;
  cards: Record<string, CardState>;
  log: DayLog[];
}

export const cardId = (kind: CardKind, key: string): string => `${kind === 'tone' ? 't' : 'r'}:${key}`;
