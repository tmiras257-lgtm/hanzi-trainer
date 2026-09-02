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
  decomp: string;            // ideographic description sequence, e.g. ⿰女子
  comps: string[];
  hsk: number | null;        // HSK 3.0
  hskOld: number | null;     // HSK 2.0
  hint: string;              // etymology mnemonic, when makemeahanzi has one
  alts: CharAlt[];           // other readings (多音字)
  words: CharWord[];
}

/** Per-character learning state. Persisted. */
export interface CardState {
  c: string;
  ef: number;                // SM-2 ease factor
  interval: number;          // days
  reps: number;              // successful reps in a row
  lapses: number;
  due: string;               // YYYY-MM-DD
  introduced: string;        // YYYY-MM-DD
  history: number[];         // last grades, newest last
  writeOk: number;
  writeTotal: number;
  quizOk: number;
  quizTotal: number;
}

export interface DayLog {
  day: string;
  reviews: number;
  learned: number;
  xp: number;
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
  dailyNewCap: number | null; // null = derive from session length
}

export type SessionLength = 30 | 45 | 60;

export interface AppState {
  version: number;
  profile: Profile;
  cards: Record<string, CardState>;
  log: DayLog[];
}
