/* Checks the pinyin parser and the pitch/tone engine on synthetic input.
   No microphone involved: frames are generated from known contours. */
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
  code = code.replace(/from '\.\/(\w+)'/g, (_m, n) => `from '${pathToFileURL(path.join(OUT, n + '.mjs')).href}'`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, rel + '.mjs'), code);
}

for (const m of ['pinyin', 'pitch']) await load(m);
const pinyin = await import(pathToFileURL(path.join(OUT, 'pinyin.mjs')).href);
const pitch = await import(pathToFileURL(path.join(OUT, 'pitch.mjs')).href);

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name} ${detail}`); failures++; }
};

console.log('pinyin');
check('toneOf hǎo = 3', pinyin.toneOf('hǎo') === 3, `got ${pinyin.toneOf('hǎo')}`);
check('toneOf yī = 1', pinyin.toneOf('yī') === 1);
check('toneOf de = 5 (neutral)', pinyin.toneOf('de') === 5);
check('toneOf lǜ = 4 keeps ü', pinyin.toneOf('lǜ') === 4 && pinyin.stripTone('lǜ') === 'lü', `base=${pinyin.stripTone('lǜ')}`);
check('parsePinyin "mù dì" -> 2 syllables', pinyin.parsePinyin('mù dì').length === 2);
check('numbered form mù -> mu4', pinyin.parseSyllable('mù').numbered === 'mu4', pinyin.parseSyllable('mù').numbered);
check('toneSequence "nǐ hǎo" = [3,3]', JSON.stringify(pinyin.toneSequence('nǐ hǎo')) === '[3,3]');
check('sandhi [3,3] -> [2,3]', JSON.stringify(pinyin.applySandhi([3, 3])) === '[2,3]');
check('sandhi [3,3,3] -> [2,2,3]', JSON.stringify(pinyin.applySandhi([3, 3, 3])) === '[2,2,3]');

console.log('detectPitch on synthetic tones');
for (const hz of [110, 180, 250, 330]) {
  const sr = 44100;
  const buf = new Float32Array(2048);
  // Two harmonics, so it is not a trivially pure sine.
  for (let i = 0; i < buf.length; i++) {
    buf[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sr) + 0.25 * Math.sin((4 * Math.PI * hz * i) / sr);
  }
  const r = pitch.detectPitch(buf, sr);
  check(`${hz} Hz detected`, Math.abs(r.hz - hz) < hz * 0.03, `got ${r.hz.toFixed(1)} clarity ${r.clarity.toFixed(2)}`);
}
check('silence reports no pitch', pitch.detectPitch(new Float32Array(2048), 44100).hz === 0);

console.log('classifyTone on synthetic contours');
function framesFor(shape, { ms = 500, fps = 60, base = 180, jitter = 0 } = {}) {
  const out = [];
  const n = Math.round((ms / 1000) * fps);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const idx = t * (shape.length - 1);
    const lo = Math.floor(idx), hi = Math.min(shape.length - 1, lo + 1);
    const st = shape[lo] + (shape[hi] - shape[lo]) * (idx - lo) + (Math.random() - 0.5) * 2 * jitter;
    out.push({ t: (i / fps) * 1000, hz: base * Math.pow(2, st / 12), clarity: 0.9, rms: 0.05 });
  }
  return out;
}

for (const tone of [1, 2, 3, 4]) {
  const clean = pitch.classifyTone(framesFor(pitch.TONE_TEMPLATES[tone]));
  check(`tone ${tone} clean`, clean.tone === tone, `got ${clean.tone}, scores ${JSON.stringify(clean.scores)}`);
  const noisy = pitch.classifyTone(framesFor(pitch.TONE_TEMPLATES[tone], { jitter: 0.8, base: 110 }));
  check(`tone ${tone} with jitter, low voice`, noisy.tone === tone, `got ${noisy.tone}`);
}

const wrong = pitch.classifyTone(framesFor(pitch.TONE_TEMPLATES[4]));
check('falling contour is not read as rising', wrong.scores[2] < wrong.scores[4]);
check('too short take is rejected', pitch.classifyTone(framesFor(pitch.TONE_TEMPLATES[1], { ms: 60 })).tone === null);
check('silence is rejected', pitch.classifyTone([]).tone === null);

const t2 = pitch.classifyTone(framesFor(pitch.TONE_TEMPLATES[2]));
check('rising contour reports positive slope', t2.slope > 2, `slope ${t2.slope.toFixed(2)}`);
const t4 = pitch.classifyTone(framesFor(pitch.TONE_TEMPLATES[4]));
check('falling contour reports negative slope', t4.slope < -2, `slope ${t4.slope.toFixed(2)}`);

fs.rmSync(OUT, { recursive: true, force: true });
console.log(failures ? `\n${failures} failing check(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
