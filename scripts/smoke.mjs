/* Logic smoke test: runs the SRS + selection + session planner over a simulated 60-day study run. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Transpile the pure-logic modules on the fly; none of them touch the DOM.
const loaded = new Map();
async function load(rel) {
  if (loaded.has(rel)) return loaded.get(rel);
  const file = path.join(ROOT, 'src/lib', rel + '.ts');
  let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  code = code.replace(/from '\.\.\/data\/characters\.json'/, `from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'src/data/characters.json')).href)} with { type: 'json' }`);
  code = code.replace(/from '\.\/(\w+)'/g, (_m, n) => `from '${pathToFileURL(path.join(ROOT, '.smoke', n + '.mjs')).href}'`);
  fs.mkdirSync(path.join(ROOT, '.smoke'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '.smoke', rel + '.mjs'), code);
  return code;
}

for (const m of ['date', 'srs', 'selection', 'format', 'session']) await load(m);

const { schedule, newCard, gradeWriting, dueCards, maturity } = await import(pathToFileURL(path.join(ROOT, '.smoke/srs.mjs')).href);
const { addDays, today, daysBetween, plural } = await import(pathToFileURL(path.join(ROOT, '.smoke/date.mjs')).href);
const { pickNew, scoreCandidates } = await import(pathToFileURL(path.join(ROOT, '.smoke/selection.mjs')).href);
const { buildSession, PLANS } = await import(pathToFileURL(path.join(ROOT, '.smoke/session.mjs')).href);
const { levelFromXp, maskChar, toneOf, hskLabel } = await import(pathToFileURL(path.join(ROOT, '.smoke/format.mjs')).href);

const CHARACTERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/characters.json'), 'utf8'));
const BY_CHAR = new Map(CHARACTERS.map((h) => [h.c, h]));

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log('  ok  ', name);
  } catch (e) {
    failures++;
    console.log('  FAIL', name, '-', e.message);
  }
};

console.log('\ndates');
check('addDays crosses a month boundary', () => {
  if (addDays('2026-01-31', 1) !== '2026-02-01') throw new Error(addDays('2026-01-31', 1));
});
check('addDays survives a DST transition', () => {
  // Europe/Moscow has none, but many zones shift in late March; the helper must stay on day granularity.
  const d = addDays('2026-03-28', 1);
  if (d !== '2026-03-29') throw new Error(d);
  if (daysBetween('2026-03-28', '2026-03-29') !== 1) throw new Error('span');
});
check('plural picks Russian forms', () => {
  if (plural(1, 'a', 'b', 'c') !== 'a') throw new Error('1');
  if (plural(3, 'a', 'b', 'c') !== 'b') throw new Error('3');
  if (plural(11, 'a', 'b', 'c') !== 'c') throw new Error('11');
  if (plural(22, 'a', 'b', 'c') !== 'b') throw new Error('22');
});

console.log('\nsrs');
check('perfect reps grow the interval', () => {
  let c = newCard('好', '2026-01-01');
  const seen = [];
  let day = '2026-01-01';
  for (let i = 0; i < 6; i++) {
    c = schedule(c, 5, day);
    seen.push(c.interval);
    day = c.due;
  }
  if (seen[0] !== 1 || seen[1] !== 3) throw new Error('early intervals ' + seen);
  for (let i = 1; i < seen.length; i++) if (seen[i] <= seen[i - 1]) throw new Error('not monotonic ' + seen);
});
check('a lapse drops to one day but keeps some ease', () => {
  let c = newCard('好', '2026-01-01');
  for (let i = 0; i < 4; i++) c = schedule(c, 5, '2026-01-01');
  const before = c.ef;
  c = schedule(c, 1, '2026-01-01');
  if (c.interval !== 1) throw new Error('interval ' + c.interval);
  if (c.reps !== 0) throw new Error('reps');
  if (c.lapses !== 1) throw new Error('lapses');
  if (!(c.ef < before && c.ef >= 1.3)) throw new Error('ef ' + c.ef);
});
check('ease factor stays inside SM-2 bounds', () => {
  let c = newCard('好', '2026-01-01');
  for (let i = 0; i < 40; i++) c = schedule(c, 0, '2026-01-01');
  if (Number.isNaN(new Date(c.due + 'T00:00:00').getTime())) throw new Error('unusable due date');
  if (c.ef < 1.3) throw new Error('below floor ' + c.ef);
  let d = newCard('大', '2026-01-01');
  for (let i = 0; i < 40; i++) d = schedule(d, 5, '2026-01-01');
  if (Number.isNaN(new Date(d.due + 'T00:00:00').getTime())) throw new Error('unusable due date');
  if (d.interval > 365) throw new Error('interval unbounded: ' + d.interval);
  if (d.ef > 2.8) throw new Error('above ceiling ' + d.ef);
});
check('writing grades map onto 0-5', () => {
  if (gradeWriting(0, false, false) !== 5) throw new Error('clean');
  if (gradeWriting(9, false, false) !== 2) throw new Error('messy');
  if (gradeWriting(0, false, true) !== 1) throw new Error('revealed');
  if (gradeWriting(0, true, false) !== 2) throw new Error('hinted');
});

console.log('\nselection');
check('first pick is high-frequency and cheap to write', () => {
  const [first] = pickNew(CHARACTERS, {}, 1);
  if (first.hanzi.strokes > 4) throw new Error(`${first.hanzi.c} has ${first.hanzi.strokes} strokes`);
  if (first.hanzi.rank > 60) throw new Error(`${first.hanzi.c} rank ${first.hanzi.rank}`);
});
check('known components pull a character forward', () => {
  const before = scoreCandidates(CHARACTERS, {}).findIndex((s) => s.hanzi.c === '好');
  const cards = { 女: newCard('女'), 子: newCard('子') };
  const after = scoreCandidates(CHARACTERS, cards).findIndex((s) => s.hanzi.c === '好');
  if (!(after < before)) throw new Error(`好 moved ${before} -> ${after}`);
});
check('already-learned characters never reappear', () => {
  const cards = Object.fromEntries(CHARACTERS.slice(0, 50).map((h) => [h.c, newCard(h.c)]));
  const picked = pickNew(CHARACTERS, cards, 20);
  if (picked.some((p) => cards[p.hanzi.c])) throw new Error('duplicate');
});
check('the whole set is reachable', () => {
  const cards = {};
  for (let i = 0; i < CHARACTERS.length; i++) {
    const [p] = pickNew(CHARACTERS, cards, 1);
    if (!p) throw new Error(`ran dry after ${i}`);
    cards[p.hanzi.c] = newCard(p.hanzi.c);
  }
  if (Object.keys(cards).length !== CHARACTERS.length) throw new Error('missed some');
});

console.log('\nsession');
const mkState = (cards = {}, minutes = 45) => ({
  version: 1,
  profile: { xp: 0, streak: 0, bestStreak: 0, lastStudyDay: null, sessionMinutes: minutes, totalReviews: 0, totalLearned: 0, createdAt: today(), ttsVoice: null, dailyNewCap: null },
  cards,
  log: [],
});
check('a first session teaches and drills without reviews', () => {
  const s = buildSession(CHARACTERS, BY_CHAR, mkState(), { audio: true });
  const phases = new Set(s.steps.map((x) => x.phase));
  if (phases.has('warmup')) throw new Error('nothing should be due yet');
  if (s.newChars.length !== PLANS[45].newCount) throw new Error('new count');
  for (const c of s.newChars.map((x) => x.hanzi.c)) {
    const kinds = s.steps.filter((x) => x.c === c).map((x) => x.kind);
    if (!kinds.includes('intro') || !kinds.includes('trace') || !kinds.includes('write')) throw new Error('missing stage for ' + c);
  }
});
check('every quiz question has one right answer among four', () => {
  const cards = Object.fromEntries(CHARACTERS.slice(0, 80).map((h) => [h.c, newCard(h.c)]));
  const s = buildSession(CHARACTERS, BY_CHAR, mkState(cards), { audio: true });
  const quizzes = s.steps.filter((x) => x.kind === 'quiz');
  if (quizzes.length === 0) throw new Error('no quiz built');
  for (const { q } of quizzes) {
    if (new Set(q.options).size !== 4) throw new Error(`options not distinct for ${q.target}: ${q.options}`);
    const target = BY_CHAR.get(q.target);
    const right = q.type === 'char2meaning' ? target.ru || target.en : target.c;
    if (!q.options.includes(right)) throw new Error(`no correct option for ${q.target}`);
  }
});
check('review load is capped at the plan', () => {
  const cards = Object.fromEntries(CHARACTERS.slice(0, 300).map((h) => [h.c, newCard(h.c)]));
  const s = buildSession(CHARACTERS, BY_CHAR, mkState(cards, 30), { audio: false });
  if (s.reviewChars.length !== PLANS[30].reviewCap) throw new Error(s.reviewChars.length);
  if (s.steps.filter((x) => x.phase === 'warmup').length !== PLANS[30].reviewCap) throw new Error('warmup steps');
});
check('audio questions disappear when TTS is missing', () => {
  const cards = Object.fromEntries(CHARACTERS.slice(0, 80).map((h) => [h.c, newCard(h.c)]));
  const s = buildSession(CHARACTERS, BY_CHAR, mkState(cards), { audio: false });
  if (s.steps.some((x) => x.kind === 'quiz' && x.q.type === 'audio2char')) throw new Error('audio question leaked');
});

console.log('\nsimulated 60-day run (85% recall)');
check('load stays bounded and characters accumulate', () => {
  let state = mkState();
  let day = today();
  let maxLoad = 0;
  for (let d = 0; d < 60; d++) {
    const s = buildSession(CHARACTERS, BY_CHAR, state, { audio: true, day });
    maxLoad = Math.max(maxLoad, s.steps.length);
    for (const step of s.steps) {
      if (step.kind === 'intro') state.cards[step.c] = newCard(step.c, day);
      if (step.kind === 'review' || (step.kind === 'write' && step.phase === 'learn')) {
        const q = Math.random() < 0.85 ? 4 : 2;
        state.cards[step.c] = schedule(state.cards[step.c] ?? newCard(step.c, day), q, day);
      }
    }
    day = addDays(day, 1);
    state = { ...state, profile: { ...state.profile, lastStudyDay: day } };
    // dueCards must be computed against the simulated calendar
    const due = dueCards(state.cards, day);
    if (due.length > 400) throw new Error(`backlog exploded to ${due.length} on day ${d}`);
  }
  const learned = Object.keys(state.cards).length;
  if (learned < 200) throw new Error(`only ${learned} characters after 60 days`);
  const mature = Object.values(state.cards).filter((c) => maturity(c) === 'mature').length;
  console.log(`       learned=${learned} mature=${mature} peak session steps=${maxLoad}`);
});

console.log('\nformat');
check('gloss masking hides the answer', () => {
  if (maskChar('что (в составе 什么)', '什') !== 'что (в составе ◯么)') throw new Error(maskChar('что (в составе 什么)', '什'));
});
check('tone extraction', () => {
  if (toneOf('hǎo') !== 3) throw new Error('hao');
  if (toneOf('de') !== 0) throw new Error('de');
  if (toneOf('shì') !== 4) throw new Error('shi');
});
check('levels always advance', () => {
  let prev = 0;
  for (let xp = 0; xp < 50000; xp += 97) {
    const { level, into, span } = levelFromXp(xp);
    if (level < prev) throw new Error('level went backwards');
    if (into >= span) throw new Error(`into ${into} >= span ${span} at ${xp}`);
    prev = level;
  }
});
check('HSK label is available for reference only', () => {
  const h = BY_CHAR.get('好');
  if (!hskLabel(h).includes('HSK')) throw new Error(hskLabel(h));
});

console.log('\ndataset');
check('every character has pinyin, a gloss and stroke data', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/strokeIndex.json'), 'utf8')).index;
  for (const h of CHARACTERS) {
    if (!h.py) throw new Error('no pinyin: ' + h.c);
    if (!h.en && !h.ru) throw new Error('no gloss: ' + h.c);
    if (idx[h.c] === undefined) throw new Error('no strokes: ' + h.c);
  }
});
check('stroke chunks contain what the index promises', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/strokeIndex.json'), 'utf8'));
  for (let n = 0; n < meta.chunks; n++) {
    const chunk = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/strokes', `chunk-${n}.json`), 'utf8'));
    for (const [c, d] of Object.entries(chunk)) {
      if (meta.index[c] !== n) throw new Error(`${c} indexed to ${meta.index[c]} but stored in ${n}`);
      if (!Array.isArray(d.strokes) || !d.strokes.length) throw new Error('empty strokes ' + c);
      if (d.medians.length !== d.strokes.length) throw new Error('median mismatch ' + c);
    }
  }
});
check('frequency ranks are strictly increasing', () => {
  for (let i = 1; i < CHARACTERS.length; i++) {
    if (CHARACTERS[i].rank <= CHARACTERS[i - 1].rank) throw new Error(`rank order at ${i}`);
  }
});

fs.rmSync(path.join(ROOT, '.smoke'), { recursive: true, force: true });
console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
