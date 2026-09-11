/**
 * Exercise generation and the session queue.
 *
 * Four drills, each attacking the tone from a different side: hearing which
 * tone was said, telling two tones of the same syllable apart, producing the
 * tone with your own voice, and reading a character's pinyin. A session
 * interleaves them so the same syllable gets met in more than one way.
 */

import type { AppState, CardState, DrillToggles, SessionLength } from './types';
import { cardId } from './types';
import type { Tone } from './pinyin';
import type { SyllableEntry } from './syllables';
import { BY_CHAR, BY_ID, SYLLABLES, distractors, BY_BASE } from './syllables';
import { dueCards, newCard } from './srs';
import { today } from './date';

export type DrillKind = keyof DrillToggles;

export interface DrillBase {
  /** Card this attempt schedules. */
  cardId: string;
  syllable: SyllableEntry;
  /** A character read this way, for display and for speech synthesis. */
  char: string;
  /** True when the card is being met for the first time. */
  fresh: boolean;
}

export type Drill =
  | (DrillBase & { kind: 'hearTone'; options: Tone[] })
  | (DrillBase & { kind: 'minimalPair'; options: SyllableEntry[] })
  | (DrillBase & { kind: 'sayTone' })
  | (DrillBase & { kind: 'readPinyin'; options: SyllableEntry[] });

export function shuffle<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A character to show and to speak for this syllable — the most frequent one. */
function charFor(s: SyllableEntry): string {
  return s.chars[0] ?? '';
}

/** New syllables, most frequent first, skipping anything already in the deck. */
export function pickNewSyllables(state: AppState, count: number): SyllableEntry[] {
  const out: SyllableEntry[] = [];
  for (const s of SYLLABLES) {
    if (out.length >= count) break;
    if (state.cards[cardId('tone', s.id)]) continue;
    if (!s.chars.length) continue;
    out.push(s);
  }
  return out;
}

/** How many new syllables a session of this length should introduce. */
export function newQuota(minutes: SessionLength, cap: number | null): number {
  const base = minutes === 10 ? 3 : minutes === 20 ? 6 : 10;
  return cap === null ? base : Math.min(base, cap);
}

/** Roughly how many graded attempts fit into a session of this length. */
export function attemptQuota(minutes: SessionLength): number {
  return minutes === 10 ? 18 : minutes === 20 ? 36 : 56;
}

function enabledKinds(t: DrillToggles): DrillKind[] {
  const on = (Object.keys(t) as DrillKind[]).filter((k) => t[k]);
  return on.length ? on : ['hearTone'];
}

function makeHearTone(s: SyllableEntry, fresh: boolean): Drill {
  return {
    kind: 'hearTone',
    cardId: cardId('tone', s.id),
    syllable: s,
    char: charFor(s),
    fresh,
    // The four tones are always all offered: the question is which one was
    // said, not which ones exist for this syllable.
    options: [1, 2, 3, 4] as Tone[],
  };
}

function makeMinimalPair(s: SyllableEntry, fresh: boolean): Drill | null {
  const siblings = (BY_BASE.get(s.base) ?? []).filter((v) => v.id !== s.id);
  if (!siblings.length) return null;
  const options = shuffle([s, ...shuffle(siblings).slice(0, 3)]);
  return { kind: 'minimalPair', cardId: cardId('tone', s.id), syllable: s, char: charFor(s), fresh, options };
}

function makeSayTone(s: SyllableEntry, fresh: boolean): Drill {
  return { kind: 'sayTone', cardId: cardId('tone', s.id), syllable: s, char: charFor(s), fresh };
}

function makeReadPinyin(s: SyllableEntry, fresh: boolean): Drill | null {
  const char = charFor(s);
  if (!char) return null;
  const wrong = distractors(s, 3);
  if (wrong.length < 2) return null;
  return {
    kind: 'readPinyin',
    cardId: cardId('read', char),
    syllable: s,
    char,
    fresh,
    options: shuffle([s, ...wrong.slice(0, 3)]),
  };
}

function build(kind: DrillKind, s: SyllableEntry, fresh: boolean): Drill | null {
  switch (kind) {
    case 'hearTone': return makeHearTone(s, fresh);
    case 'minimalPair': return makeMinimalPair(s, fresh);
    case 'sayTone': return makeSayTone(s, fresh);
    case 'readPinyin': return makeReadPinyin(s, fresh);
  }
}

/** Build a drill of any enabled kind, falling back when one cannot be made. */
function buildAny(kinds: DrillKind[], s: SyllableEntry, fresh: boolean): Drill | null {
  for (const kind of shuffle(kinds)) {
    const d = build(kind, s, fresh);
    if (d) return d;
  }
  return null;
}

function syllableOfCard(card: CardState): SyllableEntry | undefined {
  if (card.kind === 'tone') return BY_ID.get(card.key);
  const h = BY_CHAR.get(card.key);
  if (!h) return undefined;
  const first = h.py.split(/\s+/)[0];
  return SYLLABLES.find((s) => s.marked === first && s.chars.includes(card.key));
}

export interface SessionPlan {
  drills: Drill[];
  /** Syllables met for the first time in this session. */
  introduced: SyllableEntry[];
  dueCount: number;
}

/**
 * A session is: everything due, then new syllables, each new one drilled twice
 * so it is not met once and forgotten. Order is interleaved rather than
 * blocked — reviews and new material alternate, which is harder and sticks.
 *
 * The whole queue is held under one budget. New material is planned first and
 * reviews fill whatever is left, except when the backlog has grown past the
 * budget on its own: then new syllables are withheld entirely, because adding
 * to a deck you are already behind on only makes the next day worse.
 */
export function planSession(state: AppState, day = today()): SessionPlan {
  const { profile } = state;
  const kinds = enabledKinds(profile.drills);
  const due = dueCards(state.cards, day);
  const budget = attemptQuota(profile.sessionMinutes);

  const backlogged = due.length >= budget;
  const quota = backlogged ? 0 : newQuota(profile.sessionMinutes, profile.dailyNewCap);
  const fresh = pickNewSyllables(state, quota);

  const intro: Drill[] = [];
  for (const s of fresh) {
    // Never meet a syllable for the first time through the microphone: you
    // have to have heard it before you can be asked to produce it.
    const first = buildAny(kinds.filter((k) => k !== 'sayTone'), s, true) ?? buildAny(kinds, s, true);
    if (first) intro.push(first);
    const second = buildAny(kinds.filter((k) => k !== first?.kind), s, false);
    if (second) intro.push(second);
  }

  // New material may take at most 30% of a session, so a large daily cap
  // cannot crowd out the reviews that are actually due.
  const introCap = backlogged ? 0 : Math.max(2, Math.ceil(budget * 0.3));
  const introduced = intro.length > introCap ? intro.slice(0, introCap) : intro;

  const reviewBudget = Math.max(0, budget - introduced.length);
  const reviews: Drill[] = [];
  for (const card of due) {
    if (reviews.length >= reviewBudget) break;
    const s = syllableOfCard(card);
    if (!s) continue;
    // A reading card only ever produces its own drill; a tone card can take
    // whichever listening or speaking drill is switched on.
    const allowed = card.kind === 'read' ? (['readPinyin'] as DrillKind[]) : kinds.filter((k) => k !== 'readPinyin');
    const d = buildAny(allowed.length ? allowed : kinds, s, false);
    if (d) reviews.push(d);
  }

  const keptFresh = fresh.filter((s) => introduced.some((d) => d.syllable.id === s.id));
  return { drills: interleave(reviews, introduced), introduced: keptFresh, dueCount: due.length };
}

/** Weave two queues together so neither runs as an unbroken block. */
function interleave(a: Drill[], b: Drill[]): Drill[] {
  const out: Drill[] = [];
  const total = a.length + b.length;
  if (!total) return out;
  const ratio = a.length / total;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const takeA = j >= b.length || (i < a.length && Math.random() < ratio);
    out.push(takeA ? a[i++] : b[j++]);
  }
  return out;
}

/** A card, created on demand the first time an item is answered. */
export function ensureCard(state: AppState, drill: Drill, day = today()): CardState {
  const existing = state.cards[drill.cardId];
  if (existing) return existing;
  return drill.kind === 'readPinyin' ? newCard('read', drill.char, day) : newCard('tone', drill.syllable.id, day);
}

export const DRILL_NAMES: Record<DrillKind, string> = {
  hearTone: 'Какой тон',
  minimalPair: 'Минимальные пары',
  sayTone: 'Произнести',
  readPinyin: 'Чтение иероглифа',
};

export const DRILL_BLURBS: Record<DrillKind, string> = {
  hearTone: 'Слушаешь слог и определяешь тон. Основа всего остального.',
  minimalPair: 'Один и тот же слог в разных тонах: mā или mǎ. Самое тонкое различение.',
  sayTone: 'Произносишь вслух, микрофон рисует контур твоего голоса и сравнивает с эталоном.',
  readPinyin: 'Видишь иероглиф — выбираешь его чтение. Без письма.',
};
