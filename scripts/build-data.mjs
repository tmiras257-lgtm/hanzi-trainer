import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.SRC_DIR;
const LIMIT = Number(process.env.CHAR_LIMIT || 800);
const CHUNK = 100;

/* ---------- 1. hanziDB: frequency rank, pinyin, gloss, radical, strokes, old HSK ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvRows = parseCsv(fs.readFileSync(path.join(SRC, 'hanziDB.csv'), 'utf8'));
const header = csvRows[0];
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const freq = new Map();
for (const r of csvRows.slice(1)) {
  const c = r[col['charcter']];
  if (!c || freq.has(c)) continue;
  freq.set(c, {
    rank: Number(r[col['frequency_rank']]),
    pinyin: (r[col['pinyin']] || '').trim(),
    en: (r[col['definition']] || '').trim(),
    radical: (r[col['radical']] || '').trim(),
    strokes: Number(r[col['stroke_count']]) || 0,
    hskOld: Number(r[col['hsk_level']]) || null,
  });
}

/* ---------- 2. makemeahanzi: decomposition, etymology hint ---------- */
const mmah = new Map();
for (const line of fs.readFileSync(path.join(SRC, 'mmah_dict.txt'), 'utf8').trim().split('\n')) {
  const e = JSON.parse(line);
  mmah.set(e.character, e);
}

/* ---------- 3. HSK vocabulary: new HSK levels + example words ---------- */
const hsk = JSON.parse(fs.readFileSync(path.join(SRC, 'hsk_complete.json'), 'utf8'));
const levelOf = (entry) => {
  const lv = entry.level || [];
  const pick = (p) => {
    const hit = lv.filter(l => l.startsWith(p + '-')).map(l => Number(l.split('-')[1]));
    return hit.length ? Math.min(...hit) : null;
  };
  return { neu: pick('newest') ?? pick('new'), old: pick('old') };
};

const stripTone = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, '').toLowerCase();

const singleChar = new Map();          // char -> hsk entry
const wordsByChar = new Map();         // char -> [word entries]
for (const e of hsk) {
  const w = e.simplified;
  if (!w) continue;
  if ([...w].length === 1) {
    // homographs: keep the reading with the best (lowest) frequency rank
    const prev = singleChar.get(w);
    if (!prev || (e.frequency || 1e9) < (prev.frequency || 1e9)) singleChar.set(w, e);
    continue;
  }
  if ([...w].length > 4) continue;
  for (const ch of new Set([...w])) {
    if (!wordsByChar.has(ch)) wordsByChar.set(ch, []);
    wordsByChar.get(ch).push(e);
  }
}

/* ---------- 4. stroke data availability ---------- */
const STROKE_DIR = path.join(ROOT, 'node_modules', 'hanzi-writer-data');
const hasStrokes = (c) => fs.existsSync(path.join(STROKE_DIR, `${c}.json`));

/* ---------- 5. build the character list ---------- */
const CJK = /[一-鿿]/;
const candidates = [...freq.entries()]
  .filter(([c]) => CJK.test(c) && hasStrokes(c))
  .sort((a, b) => a[1].rank - b[1].rank)
  .slice(0, LIMIT);

const inSet = new Set(candidates.map(([c]) => c));

const readJson = (f) => {
  const p = path.join(__dirname, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
};
const ru = readJson('ru-glosses.json');
// Hand corrections where the open datasets lead with a rare or archaic sense.
const enOverride = readJson('en-overrides.json');

// Meanings that describe the glyph rather than its sense - useful, but never first.
const META = /^\s*(surname |old variant|variant of|used in|abbr\. for|\(Japanese surname\)|Taiwan pr\.|see |rad\. no)/i;

function tidy(parts, max = 4) {
  const list = (Array.isArray(parts) ? parts : String(parts).split(/[;]/))
    .map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  const uniq = list.filter(s => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const good = uniq.filter(s => !META.test(s));
  return (good.length ? good : uniq).slice(0, max).join('; ');
}

const characters = candidates.map(([c, f], i) => {
  const m = mmah.get(c) || {};
  const sc = singleChar.get(c);
  const decomp = m.decomposition && m.decomposition !== '？' ? m.decomposition : '';
  const comps = [...new Set([...decomp].filter(x => CJK.test(x) && x !== c))];
  const scLevels = sc ? levelOf(sc) : { neu: null, old: null };

  // A 多音字 entry lists every reading; pick the one Jun Da's list calls dominant.
  const forms = (sc?.forms || []).map(fm => ({
    py: (fm.transcriptions?.pinyin || '').toLowerCase(),
    good: (fm.meanings || []).filter(x => !META.test(x)),
    all: fm.meanings || [],
  }));
  const exact = (f.pinyin || '').trim().toLowerCase();
  const target = stripTone(f.pinyin);
  const best =
    forms.find(fm => exact && fm.py === exact && fm.good.length) ||
    forms.find(fm => exact && fm.py === exact) ||
    forms.find(fm => target && stripTone(fm.py) === target && fm.good.length) ||
    forms.find(fm => target && stripTone(fm.py) === target) ||
    forms.filter(fm => fm.good.length).sort((a, b) => b.good.length - a.good.length)[0] ||
    forms[0];

  const pinyin = (best?.py || f.pinyin || m.pinyin?.[0] || '').toLowerCase();
  const en = enOverride[c] || tidy(best?.good?.length ? best.good : (best?.all || []), 4) ||
             tidy(f.en || m.definition || '', 4);

  // Other readings of the same character - worth knowing, but kept out of the main gloss.
  const alts = [];
  for (const fm of forms) {
    if (!fm.good.length || stripTone(fm.py) === stripTone(pinyin)) continue;
    if (alts.some(a => stripTone(a.py) === stripTone(fm.py))) continue;
    alts.push({ py: fm.py, en: tidy(fm.good, 2) });
  }

  const words = (wordsByChar.get(c) || [])
    .slice()
    .sort((a, b) => (a.frequency || 1e9) - (b.frequency || 1e9))
    .filter(w => [...w.simplified].every(ch => inSet.has(ch) || ch === c))
    .slice(0, 4)
    .map(w => ({
      w: w.simplified,
      p: w.forms?.[0]?.transcriptions?.pinyin || '',
      e: (w.forms?.[0]?.meanings || []).slice(0, 2).join('; '),
      h: levelOf(w).neu,
    }));

  return {
    i,
    c,
    rank: f.rank,
    py: pinyin,
    en,
    ru: ru[c] || '',
    strokes: f.strokes || null,
    radical: m.radical || f.radical || '',
    decomp,
    comps,
    hsk: scLevels.neu,
    hskOld: scLevels.old ?? f.hskOld,
    hint: m.etymology?.hint || '',
    alts: alts.slice(0, 3),
    words,
  };
});

fs.mkdirSync(path.join(ROOT, 'src', 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src', 'data', 'characters.json'), JSON.stringify(characters));

/* ---------- 6. stroke data chunks ---------- */
const outDir = path.join(ROOT, 'public', 'strokes');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const index = {};
let chunkNo = 0;
for (let i = 0; i < characters.length; i += CHUNK) {
  const slice = characters.slice(i, i + CHUNK);
  const bundle = {};
  for (const ch of slice) {
    const raw = JSON.parse(fs.readFileSync(path.join(STROKE_DIR, `${ch.c}.json`), 'utf8'));
    bundle[ch.c] = { strokes: raw.strokes, medians: raw.medians };
    index[ch.c] = chunkNo;
  }
  fs.writeFileSync(path.join(outDir, `chunk-${chunkNo}.json`), JSON.stringify(bundle));
  chunkNo++;
}
fs.writeFileSync(path.join(ROOT, 'src', 'data', 'strokeIndex.json'), JSON.stringify({ chunks: chunkNo, index }));

const withRu = characters.filter(c => c.ru).length;
const withWords = characters.filter(c => c.words.length).length;
console.log(`characters: ${characters.length}`);
console.log(`stroke chunks: ${chunkNo}`);
console.log(`with example words: ${withWords}`);
console.log(`with russian gloss: ${withRu}`);
console.log(`missing pinyin: ${characters.filter(c => !c.py).length}, missing gloss: ${characters.filter(c => !c.en).length}`);
