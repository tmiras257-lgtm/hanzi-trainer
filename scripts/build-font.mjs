/*
 * Builds a self-hosted Noto Sans SC subset holding exactly the glyphs this app
 * can render: every Chinese character in the dataset plus the full pinyin
 * alphabet with its tone diacritics.
 *
 * The point is that no glyph ever flashes. A full CJK face is 10-16 MB, so a
 * browser paints fallback glyphs for a second or two and then reflows; a subset
 * of ~1100 glyphs arrives before first paint and the swap never happens.
 *
 * Source: Noto Sans SC, SIL Open Font License 1.1 (see public/fonts/OFL.txt).
 * Subsetting and redistribution are expressly permitted by that licence.
 *
 * Run with: npm run font
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT_DIR = path.join(ROOT, 'public/fonts');

// jsDelivr mirrors the google/fonts repo and is markedly faster than raw.githubusercontent.
const FONT_URLS = [
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
  'https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
];
const LICENSE_URLS = [
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/OFL.txt',
  'https://github.com/google/fonts/raw/main/ofl/notosanssc/OFL.txt',
];

/** Every pinyin vowel in all four marked forms, plus the toneless letters. */
const PINYIN =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüêńňǹḿ' +
  'ĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛÜ';

const PUNCT = '0123456789 .,:;!?—–-\'"()[]{}/\\|·…、。，；：？！“”‘’《》〈〉%+×÷=≈°';

function collectFromData() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/characters.json'), 'utf8'));
  const set = new Set();
  const add = (s) => { for (const ch of String(s ?? '')) set.add(ch); };
  for (const h of data) {
    add(h.c); add(h.py); add(h.radical); add(h.decomp);
    (h.comps ?? []).forEach(add);
    (h.alts ?? []).forEach((a) => { add(a.py); });
    (h.words ?? []).forEach((w) => { add(w.w); add(w.p); });
  }
  return set;
}

/** Streams to disk so a slow mirror shows progress instead of looking hung. */
async function download(urls, dest) {
  if (fs.existsSync(dest)) {
    console.log(`  cached ${path.basename(dest)} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
    return dest;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length') ?? 0);
      const tmp = dest + '.part';
      const chunks = [];
      let got = 0;
      let tick = 0;
      for await (const chunk of res.body) {
        chunks.push(chunk);
        got += chunk.length;
        if (got - tick > 1e6) {
          tick = got;
          const pct = total ? ` (${Math.round((got / total) * 100)}%)` : '';
          console.log(`  ${path.basename(dest)}: ${(got / 1e6).toFixed(1)} MB${pct}`);
        }
      }
      fs.writeFileSync(tmp, Buffer.concat(chunks));
      fs.renameSync(tmp, dest);
      console.log(`  got ${path.basename(dest)} — ${(got / 1e6).toFixed(1)} MB from ${new URL(url).host}`);
      return dest;
    } catch (e) {
      lastError = e;
      console.log(`  ${new URL(url).host} failed: ${e.message}`);
    }
  }
  throw lastError ?? new Error('no mirror worked');
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const src = await download(FONT_URLS, path.join(CACHE, 'NotoSansSC-var.ttf'));
  await download(LICENSE_URLS, path.join(OUT_DIR, 'OFL.txt'));

  const chars = collectFromData();
  for (const ch of PINYIN + PUNCT) chars.add(ch);
  const text = [...chars].sort().join('');

  const cjkCount = [...chars].filter((c) => /[㐀-鿿豈-﫿]/.test(c)).length;
  console.log(`  glyph set: ${chars.size} (${cjkCount} CJK, ${chars.size - cjkCount} other)`);

  const source = fs.readFileSync(src);

  // Two static instances rather than one variable file: the wght axis costs
  // more than a second cut of ~1100 glyphs, and the UI only uses two weights.
  const weights = [
    { name: 'zh-400', wght: 400 },
    { name: 'zh-600', wght: 600 },
  ];

  const manifest = [];
  for (const { name, wght } of weights) {
    const out = await subsetFont(source, text, {
      targetFormat: 'woff2',
      variationAxes: { wght: { min: wght, max: wght, default: wght } },
    });
    const file = path.join(OUT_DIR, `${name}.woff2`);
    fs.writeFileSync(file, out);
    manifest.push({ name, wght, bytes: out.length });
    console.log(`  ${name}.woff2  ${kb(out.length)}`);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ builtFrom: 'Noto Sans SC (OFL-1.1)', glyphs: chars.size, files: manifest }, null, 2) + '\n',
  );

  const total = manifest.reduce((s, f) => s + f.bytes, 0);
  console.log(`  total ${kb(total)} vs ${(source.length / 1e6).toFixed(1)} MB full face`);
}

main().catch((e) => { console.error(e); process.exit(1); });
