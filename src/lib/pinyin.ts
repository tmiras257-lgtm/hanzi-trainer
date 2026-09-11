/**
 * Pinyin parsing.
 *
 * The dataset stores readings with tone diacritics and a space between
 * syllables ("mu4 di4" is written "mù dì"), so splitting on whitespace is
 * enough — no syllable segmenter required.
 *
 * Tone is recovered from the combining mark left after NFD normalisation:
 * macron = 1, acute = 2, caron = 3, grave = 4, none = 5 (neutral).
 */

export type Tone = 1 | 2 | 3 | 4 | 5;

const MARK_TO_TONE: Record<string, Tone> = {
  '̄': 1, // macron   ā
  '́': 2, // acute    á
  '̌': 3, // caron    ǎ
  '̀': 4, // grave    à
};

export interface Syllable {
  /** As written in the dataset, with the diacritic: "hǎo" */
  marked: string;
  /** Diacritic stripped, ü preserved: "hao" */
  base: string;
  /** Numbered form used for display and answer checking: "hao3" */
  numbered: string;
  tone: Tone;
}

/** Tone of a single syllable; 5 when it carries no mark. */
export function toneOf(syllable: string): Tone {
  for (const ch of syllable.normalize('NFD')) {
    const t = MARK_TO_TONE[ch];
    if (t) return t;
  }
  return 5;
}

/** Strip the tone diacritic but keep ü, which is a letter and not a mark. */
export function stripTone(syllable: string): string {
  return syllable
    .normalize('NFD')
    .replace(/[̀́̄̌]/g, '')
    .normalize('NFC')
    .toLowerCase();
}

export function parseSyllable(raw: string): Syllable {
  const marked = raw.trim();
  const tone = toneOf(marked);
  const base = stripTone(marked);
  return { marked, base, numbered: tone === 5 ? base : base + tone, tone };
}

/** Split a reading such as "mù dì" into its syllables. */
export function parsePinyin(reading: string): Syllable[] {
  return reading
    .split(/[\s·]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseSyllable);
}

/** Convenience: the tone sequence of a reading, e.g. "mù dì" -> [4, 4]. */
export function toneSequence(reading: string): Tone[] {
  return parsePinyin(reading).map((s) => s.tone);
}

export const TONE_NAMES: Record<Tone, string> = {
  1: 'высокий ровный',
  2: 'восходящий',
  3: 'нисходяще-восходящий',
  4: 'резко нисходящий',
  5: 'нейтральный',
};

/**
 * Chao pitch-level numerals: the tone written as the levels it moves between on
 * a 1-5 scale. Spelled with digits rather than the tone-letter glyphs (˥˧˨),
 * which most interface fonts render as indistinguishable tick marks.
 */
export const TONE_CONTOUR: Record<Tone, string> = {
  1: '55',
  2: '35',
  3: '214',
  4: '51',
  5: '·',
};

/**
 * Third tone sandhi: a third tone before another third tone is read as a
 * second. Applies left to right over a word; only the last one stays third.
 */
export function applySandhi(tones: Tone[]): Tone[] {
  const out = tones.slice();
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i] === 3 && out[i + 1] === 3) out[i] = 2;
  }
  return out;
}
