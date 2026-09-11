import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, CardState, DayLog, Profile } from './types';
import { emptyState, loadState, saveState } from './db';
import { schedule } from './srs';
import { ensureCard, type Drill } from './drill';
import { addDays, today } from './date';

export { CHARACTERS, BY_CHAR } from './syllables';

export const XP = {
  reviewPass: 10,
  reviewFail: 3,
  learn: 24,
  spokenPass: 14,
  sessionBonus: 20,
};

function touchDay(state: AppState, day: string): AppState {
  const p = state.profile;
  if (p.lastStudyDay === day) return state;
  const streak = p.lastStudyDay === addDays(day, -1) ? p.streak + 1 : 1;
  return { ...state, profile: { ...p, lastStudyDay: day, streak, bestStreak: Math.max(p.bestStreak, streak) } };
}

function bumpLog(state: AppState, day: string, patch: Partial<DayLog>): AppState {
  const log = state.log.slice();
  const i = log.findIndex((l) => l.day === day);
  const base: DayLog = i >= 0 ? log[i] : { day, reviews: 0, learned: 0, xp: 0, saidOk: 0, saidTotal: 0 };
  const next: DayLog = {
    day,
    reviews: base.reviews + (patch.reviews ?? 0),
    learned: base.learned + (patch.learned ?? 0),
    xp: base.xp + (patch.xp ?? 0),
    saidOk: base.saidOk + (patch.saidOk ?? 0),
    saidTotal: base.saidTotal + (patch.saidTotal ?? 0),
  };
  if (i >= 0) log[i] = next;
  else log.push(next);
  return { ...state, log: log.slice(-400) };
}

/** Which counter on the card a given drill feeds. */
function tally(card: CardState, drill: Drill, passed: boolean): CardState {
  switch (drill.kind) {
    case 'sayTone':
      return { ...card, sayOk: card.sayOk + (passed ? 1 : 0), sayTotal: card.sayTotal + 1 };
    case 'readPinyin':
      return { ...card, readOk: card.readOk + (passed ? 1 : 0), readTotal: card.readTotal + 1 };
    default:
      return { ...card, earOk: card.earOk + (passed ? 1 : 0), earTotal: card.earTotal + 1 };
  }
}

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const pending = useRef<AppState | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    loadState().then(setState);
  }, []);

  // Debounced so a burst of answers does not thrash IndexedDB.
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
      /**
       * Records one graded attempt. The card is created on the spot if this is
       * the first time the item has been seen, so nothing has to be "learned"
       * in a separate step before it can be answered.
       */
      answer(drill: Drill, quality: number) {
        update((s) => {
          const day = today();
          const before = s.cards[drill.cardId];
          const card = before ?? ensureCard(s, drill, day);
          const passed = quality >= 3;
          const scored = tally(schedule(card, quality, day), drill, passed);

          const isNew = !before;
          const gain = (passed ? XP.reviewPass : XP.reviewFail) + (isNew ? XP.learn : 0) +
            (drill.kind === 'sayTone' && passed ? XP.spokenPass : 0);

          let next = touchDay(s, day);
          next = {
            ...next,
            cards: { ...next.cards, [scored.id]: scored },
            profile: {
              ...next.profile,
              xp: next.profile.xp + gain,
              totalReviews: next.profile.totalReviews + 1,
              totalLearned: next.profile.totalLearned + (isNew ? 1 : 0),
            },
          };
          return bumpLog(next, day, {
            reviews: 1,
            learned: isNew ? 1 : 0,
            xp: gain,
            saidOk: drill.kind === 'sayTone' && passed ? 1 : 0,
            saidTotal: drill.kind === 'sayTone' ? 1 : 0,
          });
        });
      },

      finishSession() {
        update((s) => {
          const day = today();
          const next = { ...touchDay(s, day), profile: { ...s.profile, xp: s.profile.xp + XP.sessionBonus } };
          return bumpLog(next, day, { xp: XP.sessionBonus });
        });
      },

      setProfile(patch: Partial<Profile>) {
        update((s) => ({ ...s, profile: { ...s.profile, ...patch } }));
      },

      rescheduleCard(id: string, days: number) {
        update((s) => {
          const card = s.cards[id];
          if (!card) return s;
          return { ...s, cards: { ...s.cards, [id]: { ...card, due: addDays(today(), days), interval: days } } };
        });
      },

      forget(id: string) {
        update((s) => {
          const cards = { ...s.cards };
          delete cards[id];
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
