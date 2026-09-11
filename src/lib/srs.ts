import type { CardKind, CardState } from './types';
import { cardId } from './types';
import { addDays, today } from './date';

/**
 * SM-2, with two deviations that matter for tone practice:
 *  - a lapse drops the card to a 1-day interval instead of erasing the ease
 *    factor, so a tone you keep almost-hearing does not restart from zero;
 *  - the first two successful intervals are fixed (1d, 3d), which keeps a new
 *    syllable in sight during the first week.
 */
export const MIN_EF = 1.3;
export const MAX_EF = 2.8;
export const MAX_INTERVAL = 365;

export function newCard(kind: CardKind, key: string, day = today()): CardState {
  return {
    id: cardId(kind, key),
    kind,
    key,
    ef: 2.5,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: day,
    introduced: day,
    history: [],
    earOk: 0,
    earTotal: 0,
    sayOk: 0,
    sayTotal: 0,
    readOk: 0,
    readTotal: 0,
  };
}

/** quality: 0-5, SM-2 convention. < 3 counts as a failure. */
export function schedule(card: CardState, quality: number, day = today()): CardState {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let { ef, interval, reps, lapses } = card;

  if (q < 3) {
    lapses += 1;
    reps = 0;
    interval = 1;
    ef = clamp(ef - 0.2, MIN_EF, MAX_EF);
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 3;
    else interval = Math.min(MAX_INTERVAL, Math.max(1, Math.round(interval * ef)));
    ef = clamp(ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), MIN_EF, MAX_EF);
  }

  return { ...card, ef, interval, reps, lapses, due: addDays(day, interval), history: [...card.history, q].slice(-20) };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** A multiple-choice answer: right first time, or not. */
export function gradeChoice(correct: boolean, hintUsed: boolean, msTaken: number): number {
  if (!correct) return 1;
  if (hintUsed) return 3;
  return msTaken < 3500 ? 5 : 4;
}

/**
 * A spoken attempt, graded from how confidently the pitch tracker read the
 * intended tone. Confidence comes from the contour comparison, so a shape that
 * merely leans the right way scores lower than one that lands on it.
 */
export function gradeSpoken(confidence: number, heardRightTone: boolean, retries: number): number {
  if (!heardRightTone) return retries > 0 ? 0 : 1;
  if (confidence >= 0.75) return retries === 0 ? 5 : 4;
  if (confidence >= 0.5) return 4;
  return 3;
}

/** Rough retention: share of non-failing grades across a card's history. */
export function retention(card: CardState): number | null {
  if (!card.history.length) return null;
  return card.history.filter((q) => q >= 3).length / card.history.length;
}

export type Maturity = 'new' | 'learning' | 'young' | 'mature';

export function maturity(card: CardState): Maturity {
  if (card.reps === 0) return 'new';
  if (card.interval < 3) return 'learning';
  if (card.interval < 21) return 'young';
  return 'mature';
}

export function dueCards(cards: Record<string, CardState>, day = today()): CardState[] {
  return Object.values(cards)
    .filter((c) => c.due <= day)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.interval - b.interval));
}
