/* Logic smoke test: SRS scheduling, the session planner and the deck model,
   run over a simulated study period. No DOM, no network, no microphone. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.smoke');

async function load(rel) {
  const file = path.join(ROOT, 'src/lib', rel + '.ts');
  let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  code = code.replace(
    /from '\.\.\/data\/characters\.json'/,
    `from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'src/data/characters.json')).href)} with { type: 'json' }`,
  );
  code = code.replace(/from '\.\/(\w+)'/g, (_m, n) => `from '${pathToFileURL(path.join(OUT, n + '.mjs')).href}'`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, rel + '.mjs'), code);
}

for (const m of ['date', 'types', 'pinyin', 'srs', 'syllables', 'drill']) await load(m);
const imp = async (m) => import(pathToFileURL(path.join(OUT, m + '.mjs')).href);
const date = await imp('date');
const srs = await imp('srs');
const syl = await imp('syllables');
const drill = await imp('drill');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
  if (!ok) failures++;
};

console.log('srs');
{
  let c = srs.newCard('tone', 'ma3', '2026-01-01');
  check('new card is due immediately', c.due === '2026-01-01' && c.reps === 0);
  check('card id is prefixed', c.id === 't:ma3', c.id);

  c = srs.schedule(c, 5, '2026-01-01');
  check('first success -> 1 day', c.interval === 1, String(c.interval));
  c = srs.schedule(c, 5, '2026-01-02');
  check('second success -> 3 days', c.interval === 3, String(c.interval));
  c = srs.schedule(c, 5, '2026-01-05');
  check('third success compounds', c.interval > 3, String(c.interval));

  const beforeEf = c.ef;
  c = srs.schedule(c, 0, '2026-01-12');
  check('lapse drops to 1 day', c.interval === 1, String(c.interval));
  check('lapse keeps most of the ease factor', c.ef > srs.MIN_EF && c.ef < beforeEf, c.ef.toFixed(2));
  check('lapse counted', c.lapses === 1);

  let far = srs.newCard('tone', 'x', '2026-01-01');
  for (let i = 0; i < 40; i++) far = srs.schedule(far, 5, far.due);
  check('interval is capped', far.interval <= srs.MAX_INTERVAL, String(far.interval));
  check('due date stays valid', !Number.isNaN(Date.parse(far.due)), far.due);
}

console.log('grading');
{
  check('fast correct answer scores top', srs.gradeChoice(true, false, 1200) === 5);
  check('slow correct answer scores lower', srs.gradeChoice(true, false, 9000) === 4);
  check('wrong answer fails', srs.gradeChoice(false, false, 1000) < 3);
  check('confident spoken hit scores top', srs.gradeSpoken(0.9, true, 0) === 5);
  check('wrong tone fails', srs.gradeSpoken(0.9, false, 0) < 3);
  check('weak but right tone still passes', srs.gradeSpoken(0.4, true, 0) >= 3);
}

console.log('inventory');
{
  check('syllables built', syl.SYLLABLES.length > 300, String(syl.SYLLABLES.length));
  check('every syllable has a character', syl.SYLLABLES.every((s) => s.chars.length > 0));
  check('ids are unique', new Set(syl.SYLLABLES.map((s) => s.id)).size === syl.SYLLABLES.length);
  check('minimal pairs found', syl.MINIMAL_PAIRS.length > 100, String(syl.MINIMAL_PAIRS.length));
  check('minimal pairs really differ only in tone',
    syl.MINIMAL_PAIRS.every((p) => new Set(p.variants.map((v) => v.base)).size === 1));

  const shi = syl.BY_ID.get('shi4');
  const d = syl.distractors(shi, 4);
  check('distractors exclude the answer', d.every((x) => x.id !== 'shi4'));
  check('distractors are real syllables', d.every((x) => syl.BY_ID.has(x.id)));
  check('distractors are plausible', d.length >= 3, d.map((x) => x.marked).join(' '));
}

console.log('session planner');
{
  const profile = {
    sessionMinutes: 20, dailyNewCap: null,
    drills: { hearTone: true, minimalPair: true, sayTone: true, readPinyin: true },
  };
  let state = { version: 2, profile, cards: {}, log: [] };

  const first = drill.planSession(state, '2026-01-01');
  check('first session has work', first.drills.length > 0, `${first.drills.length} drills`);
  check('first session introduces new syllables', first.introduced.length === 6, String(first.introduced.length));
  check('every drill names a card', first.drills.every((d) => d.cardId));
  check('every drill has a character to speak', first.drills.every((d) => d.char));
  check('choice drills offer the right answer', first.drills
    .filter((d) => d.options && d.kind !== 'hearTone')
    .every((d) => d.options.some((o) => o.id === d.syllable.id)));

  // Only one drill kind enabled: the planner must not emit any other.
  const earOnly = { ...state, profile: { ...profile, drills: { hearTone: true, minimalPair: false, sayTone: false, readPinyin: false } } };
  check('respects drill toggles', drill.planSession(earOnly, '2026-01-01').drills.every((d) => d.kind === 'hearTone'));

  // A 60-day run: answer most things right, and check the deck stays sane.
  let day = '2026-01-01';
  let answered = 0;
  for (let i = 0; i < 60; i++) {
    const plan = drill.planSession(state, day);
    for (const d of plan.drills) {
      const card = state.cards[d.cardId] ?? drill.ensureCard(state, d, day);
      const q = Math.random() < 0.85 ? 5 : 1;
      state = { ...state, cards: { ...state.cards, [card.id]: srs.schedule(card, q, day) } };
      answered++;
    }
    day = date.addDays(day, 1);
  }
  const cards = Object.values(state.cards);
  check('deck grew over 60 days', cards.length > 100, `${cards.length} cards, ${answered} answers`);
  check('no card is scheduled in the past at the end', cards.every((c) => c.due >= '2026-01-01'));
  check('all due dates are valid', cards.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.due)));
  check('ease factors stay in range', cards.every((c) => c.ef >= srs.MIN_EF && c.ef <= srs.MAX_EF));
  check('mature cards appeared', cards.some((c) => srs.maturity(c) === 'mature'));

  const backlog = drill.planSession(state, day);
  check('planner caps a huge backlog', backlog.drills.length <= drill.attemptQuota(20),
    `${backlog.drills.length} <= ${drill.attemptQuota(20)} (${backlog.dueCount} due)`);
  // An explicit backlog: every card in the deck overdue at once. The planner
  // should spend the whole session clearing it and add nothing new.
  const overdue = {};
  for (const [id, c] of Object.entries(state.cards)) overdue[id] = { ...c, due: '2026-01-01' };
  const swamped = drill.planSession({ ...state, cards: overdue }, day);
  check('a real backlog fills the session', swamped.drills.length === drill.attemptQuota(20),
    `${swamped.drills.length} drills, ${swamped.dueCount} due`);
  check('a real backlog withholds new syllables', swamped.introduced.length === 0,
    String(swamped.introduced.length));

  for (const minutes of [10, 20, 30]) {
    const p2 = { ...profile, sessionMinutes: minutes };
    const fresh2 = drill.planSession({ version: 2, profile: p2, cards: {}, log: [] }, '2026-01-01');
    check(`fresh ${minutes}-min session fits its budget`,
      fresh2.drills.length <= drill.attemptQuota(minutes),
      `${fresh2.drills.length} <= ${drill.attemptQuota(minutes)}`);
    check(`fresh ${minutes}-min session never starts with the microphone`,
      !fresh2.drills.some((d) => d.kind === 'sayTone' && d.fresh));
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(failures ? `\n${failures} failing check(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
