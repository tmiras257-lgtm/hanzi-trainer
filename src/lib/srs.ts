import type { CardState } from './types';
import { addDays, today } from './date';

/**
 * SM-2, with two deviations that matter for handwriting practice:
 *  - a lapse drops the card to a 1-day interval instead of erasing the ease factor,
 *    so a character you keep almost-remembering does not restart from zero;
 *  - the first two successful intervals are fixed (1d, 3d) rather than derived,
 *    which keeps brand-new characters in sight during the first week.
 */
export const MIN_EF = 1.3;
export const MAX_EF = 2.8;
/** A year out is already far beyond "known"; letting intervals compound past that
 *  only produces dates the Date constructor cannot represent. */
export const MAX_INTERVAL = 365;

export function newCard(c: string, day = today()): CardState {
  return {
    c,
    ef: 2.5,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: day,
    introduced: day,
    history: [],
    writeOk: 0,
    writeTotal: 0,
    quizOk: 0,
    quizTotal: 0,
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

  return {
    ...card,
    ef,
    interval,
    reps,
    lapses,
    due: addDays(day, interval),
    history: [...card.history, q].slice(-20),
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** Maps a hanzi-writer quiz result onto the 0-5 SM-2 scale. */
export function gradeWriting(mistakes: number, hintUsed: boolean, revealed: boolean): number {
  if (revealed) return 1;
  if (hintUsed) return mistakes <= 2 ? 2 : 1;
  if (mistakes === 0) return 5;
  if (mistakes === 1) return 4;
  if (mistakes === 2) return 3;
  return 2;
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
