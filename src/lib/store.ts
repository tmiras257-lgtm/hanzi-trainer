import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, CardState, DayLog, Hanzi, Profile } from './types';
import { emptyState, loadState, saveState } from './db';
import { newCard, schedule } from './srs';
import { addDays, today } from './date';
import charactersRaw from '../data/characters.json';

export const CHARACTERS = charactersRaw as Hanzi[];
export const BY_CHAR = new Map(CHARACTERS.map((h) => [h.c, h]));

export const XP = {
  reviewPass: 12,
  reviewFail: 4,
  learn: 30,
  quizPass: 6,
  quizFail: 1,
  sessionBonus: 25,
};

function touchDay(state: AppState, day: string): AppState {
  const p = state.profile;
  if (p.lastStudyDay === day) return state;
  const streak = p.lastStudyDay === addDays(day, -1) ? p.streak + 1 : 1;
  return {
    ...state,
    profile: { ...p, lastStudyDay: day, streak, bestStreak: Math.max(p.bestStreak, streak) },
  };
}

function bumpLog(state: AppState, day: string, patch: Partial<DayLog>): AppState {
  const log = state.log.slice();
  const i = log.findIndex((l) => l.day === day);
  const base: DayLog = i >= 0 ? log[i] : { day, reviews: 0, learned: 0, xp: 0 };
  const next: DayLog = {
    day,
    reviews: base.reviews + (patch.reviews ?? 0),
    learned: base.learned + (patch.learned ?? 0),
    xp: base.xp + (patch.xp ?? 0),
  };
  if (i >= 0) log[i] = next;
  else log.push(next);
  return { ...state, log: log.slice(-400) };
}

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const pending = useRef<AppState | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    loadState().then(setState);
  }, []);

  // Debounced so a burst of graded strokes does not thrash IndexedDB.
  const persist = useCallback((next: AppState) => {
    pending.current = next;
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (pending.current) saveState(pending.current);
    }, 400);
  }, []);

  useEffect(() => {
    const flush = () => {
      if (pending.current) saveState(pending.current);
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  const update = useCallback(
    (fn: (s: AppState) => AppState) => {
      setState((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const actions = useMemo(
    () => ({
      /** Introduces a character: creates its card, due immediately. */
      learn(c: string) {
        update((s) => {
          if (s.cards[c]) return s;
          const day = today();
          let next = touchDay(s, day);
          next = {
            ...next,
            cards: { ...next.cards, [c]: newCard(c, day) },
            profile: {
              ...next.profile,
              xp: next.profile.xp + XP.learn,
              totalLearned: next.profile.totalLearned + 1,
            },
          };
          return bumpLog(next, day, { learned: 1, xp: XP.learn });
        });
      },

      /** A graded handwriting attempt. `advance` false = drill repetition, stats only. */
      recordWriting(c: string, quality: number, advance: boolean) {
        update((s) => {
          const day = today();
          const card = s.cards[c] ?? newCard(c, day);
          const passed = quality >= 3;
          const scored: CardState = {
            ...(advance ? schedule(card, quality, day) : card),
            writeOk: card.writeOk + (passed ? 1 : 0),
            writeTotal: card.writeTotal + 1,
          };
          const gain = passed ? XP.reviewPass : XP.reviewFail;
          let next = touchDay(s, day);
          next = {
            ...next,
            cards: { ...next.cards, [c]: scored },
            profile: {
              ...next.profile,
              xp: next.profile.xp + gain,
              totalReviews: next.profile.totalReviews + (advance ? 1 : 0),
            },
          };
          return bumpLog(next, day, { reviews: advance ? 1 : 0, xp: gain });
        });
      },

      recordQuiz(c: string, correct: boolean) {
        update((s) => {
          const day = today();
          const card = s.cards[c];
          const gain = correct ? XP.quizPass : XP.quizFail;
          let next = touchDay(s, day);
          if (card) {
            next = {
              ...next,
              cards: {
                ...next.cards,
                [c]: { ...card, quizOk: card.quizOk + (correct ? 1 : 0), quizTotal: card.quizTotal + 1 },
              },
            };
          }
          next = { ...next, profile: { ...next.profile, xp: next.profile.xp + gain } };
          return bumpLog(next, day, { xp: gain });
        });
      },

      finishSession() {
        update((s) => {
          const day = today();
          const next = {
            ...touchDay(s, day),
            profile: { ...s.profile, xp: s.profile.xp + XP.sessionBonus },
          };
          return bumpLog(next, day, { xp: XP.sessionBonus });
        });
      },

      setProfile(patch: Partial<Profile>) {
        update((s) => ({ ...s, profile: { ...s.profile, ...patch } }));
      },

      /** Pushes a card back into the queue, e.g. after a "too easy / too hard" manual override. */
      rescheduleCard(c: string, days: number) {
        update((s) => {
          const card = s.cards[c];
          if (!card) return s;
          return { ...s, cards: { ...s.cards, [c]: { ...card, due: addDays(today(), days), interval: days } } };
        });
      },

      forget(c: string) {
        update((s) => {
          const cards = { ...s.cards };
          delete cards[c];
          return { ...s, cards };
        });
      },

      replaceAll(next: AppState) {
        setState(next);
        saveState(next);
      },

      reset() {
        const fresh = emptyState();
        setState(fresh);
        saveState(fresh);
      },
    }),
    [update],
  );

  return { state, actions };
}
