/**
 * The syllable inventory the drills run on.
 *
 * A tone is a property of a syllable, not of a character, so the unit of study
 * here is a toned syllable such as "ma3" — with the characters that happen to
 * be read that way hanging off it. Everything is derived from the existing
 * dataset at module load; there is no second data file to keep in sync.
 */

import type { Hanzi } from './types';
import { parseSyllable, type Tone } from './pinyin';
import charactersRaw from '../data/characters.json';

export const CHARACTERS = charactersRaw as Hanzi[];
export const BY_CHAR = new Map(CHARACTERS.map((h) => [h.c, h]));

/** Longest first, so "zh" is matched before "z". */
const INITIALS = [
  'zh', 'ch', 'sh',
  'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h',
  'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w',
];

export function splitSyllable(base: string): { initial: string; final: string } {
  for (const i of INITIALS) {
    if (base.startsWith(i)) return { initial: i, final: base.slice(i.length) };
  }
  return { initial: '', final: base };
}

export interface SyllableEntry {
  /** Numbered form, unique: "ma3". */
  id: string;
  base: string;
  tone: Tone;
  /** With the diacritic: "mǎ". */
  marked: string;
  initial: string;
  final: string;
  /** Characters read this way, most frequent first. */
  chars: string[];
  /** Best Jun Da rank among those characters; lower is more common. */
  rank: number;
}

function build(): SyllableEntry[] {
  const acc = new Map<string, { entry: SyllableEntry; ranks: Map<string, number> }>();

  for (const h of CHARACTERS) {
    const first = h.py.split(/\s+/)[0];
    if (!first) continue;
    const syl = parseSyllable(first);
    if (!syl.base || !/^[a-zü]+$/.test(syl.base)) continue;

    const id = syl.numbered;
    let slot = acc.get(id);
    if (!slot) {
      const { initial, final } = splitSyllable(syl.base);
      slot = {
        entry: { id, base: syl.base, tone: syl.tone, marked: syl.marked, initial, final, chars: [], rank: Infinity },
        ranks: new Map(),
      };
      acc.set(id, slot);
    }
    slot.ranks.set(h.c, h.rank);
    slot.entry.rank = Math.min(slot.entry.rank, h.rank);
  }

  const out: SyllableEntry[] = [];
  for (const { entry, ranks } of acc.values()) {
    entry.chars = [...ranks.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
    out.push(entry);
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** Every toned syllable in the dataset, most common first. */
export const SYLLABLES = build();
export const BY_ID = new Map(SYLLABLES.map((s) => [s.id, s]));

/** base -> its toned variants, ordered by tone. */
export const BY_BASE = (() => {
  const m = new Map<string, SyllableEntry[]>();
  for (const s of SYLLABLES) {
    const list = m.get(s.base) ?? [];
    list.push(s);
    m.set(s.base, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.tone - b.tone);
  return m;
})();

/**
 * Bases that exist in more than one tone — the minimal pairs that make ear
 * training worth doing, because only the tone separates the options.
 */
export const MINIMAL_PAIRS: { base: string; variants: SyllableEntry[] }[] = [...BY_BASE.entries()]
  .filter(([, v]) => v.length >= 2)
  .map(([base, variants]) => ({ base, variants }))
  .sort((a, b) => Math.min(...a.variants.map((v) => v.rank)) - Math.min(...b.variants.map((v) => v.rank)));

/** Initials that learners routinely swap, used to build believable distractors. */
export const INITIAL_CONFUSIONS: string[][] = [
  ['zh', 'z', 'j'],
  ['ch', 'c', 'q'],
  ['sh', 's', 'x'],
  ['n', 'l'],
  ['f', 'h'],
  ['b', 'p'],
  ['d', 't'],
  ['g', 'k'],
  ['r', 'l'],
];

/** Finals that sound alike to a Russian ear, chiefly the -n / -ng contrast. */
export const FINAL_CONFUSIONS: string[][] = [
  ['an', 'ang'],
  ['en', 'eng'],
  ['in', 'ing'],
  ['ian', 'iang'],
  ['uan', 'uang'],
  ['ong', 'eng'],
  ['ui', 'uei', 'uai'],
  ['e', 'o'],
  ['u', 'ü'],
];

function partners(groups: string[][], value: string): string[] {
  const out = new Set<string>();
  for (const g of groups) if (g.includes(value)) g.forEach((x) => { if (x !== value) out.add(x); });
  return [...out];
}

/**
 * Wrong-but-plausible syllables for a multiple-choice question: same base in a
 * different tone first, then a swapped initial, then a swapped final. Anything
 * offered is a real syllable that exists in the dataset.
 */
export function distractors(target: SyllableEntry, count: number): SyllableEntry[] {
  const seen = new Set([target.id]);
  const out: SyllableEntry[] = [];
  const push = (s: SyllableEntry | undefined) => {
    if (!s || seen.has(s.id)) return;
    seen.add(s.id);
    out.push(s);
  };

  for (const v of BY_BASE.get(target.base) ?? []) push(v);

  for (const i of partners(INITIAL_CONFUSIONS, target.initial)) {
    push(BY_ID.get(`${i}${target.final}${target.tone === 5 ? '' : target.tone}`));
  }
  for (const f of partners(FINAL_CONFUSIONS, target.final)) {
    push(BY_ID.get(`${target.initial}${f}${target.tone === 5 ? '' : target.tone}`));
  }

  // Still short? Fall back to common syllables sharing the initial.
  if (out.length < count) {
    for (const s of SYLLABLES) {
      if (out.length >= count * 2) break;
      if (s.initial === target.initial) push(s);
    }
  }

  return out.slice(0, count);
}

/** The four toned variants of a base, filled in from the inventory where they exist. */
export function toneRow(base: string): (SyllableEntry | null)[] {
  const have = BY_BASE.get(base) ?? [];
  return [1, 2, 3, 4].map((t) => have.find((s) => s.tone === t) ?? null);
}
