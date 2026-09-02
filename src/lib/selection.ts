import type { CardState, Hanzi } from './types';

/**
 * Which character to teach next.
 *
 * Deliberately not HSK order. The score trades three things off:
 *   - frequency rank: how much reading the character unlocks per unit of effort;
 *   - stroke count: how expensive it is to learn to write right now;
 *   - component reuse: a character built only from parts you already write is
 *     nearly free, so it should jump the queue.
 * Lower is better.
 */
export interface Scored {
  hanzi: Hanzi;
  score: number;
  knownComps: string[];
  newComps: string[];
}

const STROKE_COST = 11;
const COMPONENT_BONUS = 170;
const ATOMIC_BONUS = 40; // indivisible characters are usually pictographs - cheap and foundational

export function scoreCandidates(all: Hanzi[], cards: Record<string, CardState>): Scored[] {
  const known = new Set(Object.keys(cards));
  const out: Scored[] = [];

  for (const h of all) {
    if (known.has(h.c)) continue;
    const knownComps = h.comps.filter((x) => known.has(x));
    const newComps = h.comps.filter((x) => !known.has(x));
    const ratio = h.comps.length ? knownComps.length / h.comps.length : 0;

    let score = h.rank + (h.strokes ?? 9) * STROKE_COST - ratio * COMPONENT_BONUS;
    if (h.comps.length === 0) score -= ATOMIC_BONUS;

    out.push({ hanzi: h, score, knownComps, newComps });
  }

  return out.sort((a, b) => a.score - b.score);
}

export function pickNew(all: Hanzi[], cards: Record<string, CardState>, count: number): Scored[] {
  return scoreCandidates(all, cards).slice(0, count);
}
