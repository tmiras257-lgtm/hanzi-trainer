import type { AppState, Hanzi, SessionLength } from './types';
import { dueCards, maturity } from './srs';
import { pickNew, type Scored } from './selection';
import { sample, shuffle, gloss } from './format';
import { today } from './date';

export type Phase = 'warmup' | 'learn' | 'drill' | 'quiz';

export interface QuizQuestion {
  type: 'meaning2char' | 'char2meaning' | 'audio2char';
  target: string;
  options: string[]; // characters for meaning2char/audio2char, glosses for char2meaning
}

export type Step =
  | { id: string; phase: 'warmup'; kind: 'review'; c: string }
  | { id: string; phase: 'learn'; kind: 'intro'; c: string; scored: Scored }
  | { id: string; phase: 'learn'; kind: 'trace'; c: string }
  | { id: string; phase: 'learn' | 'drill'; kind: 'write'; c: string }
  | { id: string; phase: 'quiz'; kind: 'quiz'; q: QuizQuestion };

export interface Plan {
  newCount: number;
  reviewCap: number;
  drill: number;
  quiz: number;
}

export const PLANS: Record<SessionLength, Plan> = {
  30: { newCount: 3, reviewCap: 22, drill: 6, quiz: 8 },
  45: { newCount: 5, reviewCap: 38, drill: 9, quiz: 10 },
  60: { newCount: 7, reviewCap: 55, drill: 12, quiz: 12 },
};

export interface SessionPlan {
  steps: Step[];
  newChars: Scored[];
  reviewChars: string[];
  plan: Plan;
}

let seq = 0;
const id = () => `s${seq++}`;

export function buildSession(
  all: Hanzi[],
  byChar: Map<string, Hanzi>,
  state: AppState,
  opts: { audio: boolean; day?: string } = { audio: true },
): SessionPlan {
  const day = opts.day ?? today();
  const plan = { ...PLANS[state.profile.sessionMinutes] };
  if (state.profile.dailyNewCap !== null) plan.newCount = state.profile.dailyNewCap;

  const due = dueCards(state.cards, day).slice(0, plan.reviewCap);
  const reviewChars = due.map((c) => c.c);

  // Reviews come first: they are the part of the session that decays if skipped.
  const steps: Step[] = reviewChars.map((c) => ({ id: id(), phase: 'warmup', kind: 'review', c }));

  const newChars = pickNew(all, state.cards, plan.newCount);
  for (const s of newChars) {
    steps.push({ id: id(), phase: 'learn', kind: 'intro', c: s.hanzi.c, scored: s });
    steps.push({ id: id(), phase: 'learn', kind: 'trace', c: s.hanzi.c });
    steps.push({ id: id(), phase: 'learn', kind: 'write', c: s.hanzi.c });
  }

  // Drill: today's new characters once more, then the shakiest recent ones.
  const drillPool: string[] = newChars.map((s) => s.hanzi.c);
  const recent = Object.values(state.cards)
    .filter((c) => maturity(c) !== 'mature')
    .sort((a, b) => a.ef - b.ef)
    .map((c) => c.c)
    .filter((c) => !drillPool.includes(c));
  drillPool.push(...recent.slice(0, Math.max(0, plan.drill - drillPool.length)));
  for (const c of shuffle(drillPool).slice(0, plan.drill)) {
    steps.push({ id: id(), phase: 'drill', kind: 'write', c });
  }

  // Quiz: recognition in the directions writing practice does not cover.
  const learnedPool = [...new Set([...Object.keys(state.cards), ...newChars.map((s) => s.hanzi.c)])].filter((c) =>
    byChar.has(c),
  );
  const quizTargets = shuffle([
    ...newChars.map((s) => s.hanzi.c),
    ...sample(reviewChars, plan.quiz),
  ]).slice(0, plan.quiz);

  const types: QuizQuestion['type'][] = opts.audio
    ? ['meaning2char', 'char2meaning', 'audio2char']
    : ['meaning2char', 'char2meaning'];

  quizTargets.forEach((c, i) => {
    const q = makeQuestion(c, types[i % types.length], byChar, learnedPool, all);
    if (q) steps.push({ id: id(), phase: 'quiz', kind: 'quiz', q });
  });

  return { steps, newChars, reviewChars, plan };
}

/** Distractors are drawn from characters the learner actually knows, preferring near neighbours. */
function distractors(target: Hanzi, pool: string[], byChar: Map<string, Hanzi>, all: Hanzi[], n: number): Hanzi[] {
  const candidates = pool
    .map((c) => byChar.get(c))
    .filter((h): h is Hanzi => Boolean(h) && h!.c !== target.c);

  const near = candidates.filter(
    (h) =>
      h.radical === target.radical ||
      Math.abs((h.strokes ?? 9) - (target.strokes ?? 9)) <= 1 ||
      h.comps.some((x) => target.comps.includes(x)),
  );

  const chosen = [...sample(near, n)];
  if (chosen.length < n) {
    const rest = candidates.filter((h) => !chosen.includes(h));
    chosen.push(...sample(rest, n - chosen.length));
  }
  if (chosen.length < n) {
    // Early sessions have almost nothing learned - borrow from the frequency list.
    const rest = all.filter((h) => h.c !== target.c && !chosen.includes(h)).slice(0, 300);
    chosen.push(...sample(rest, n - chosen.length));
  }
  return chosen.slice(0, n);
}

function makeQuestion(
  c: string,
  type: QuizQuestion['type'],
  byChar: Map<string, Hanzi>,
  pool: string[],
  all: Hanzi[],
): QuizQuestion | null {
  const target = byChar.get(c);
  if (!target) return null;
  const others = distractors(target, pool, byChar, all, 3);
  if (others.length < 3) return null;

  if (type === 'char2meaning') {
    return { type, target: c, options: shuffle([gloss(target), ...others.map(gloss)]) };
  }
  return { type, target: c, options: shuffle([c, ...others.map((h) => h.c)]) };
}

export function phaseLabel(p: Phase): string {
  return { warmup: 'Разминка', learn: 'Новые иероглифы', drill: 'Тренировка', quiz: 'Квиз' }[p];
}
