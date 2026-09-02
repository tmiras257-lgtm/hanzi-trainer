/*
 * End-to-end check against real Chrome. The interesting part is that it actually
 * draws the strokes: it reads the medians out of the stroke data and replays them
 * as mouse gestures, so a regression in grading or in the writer wiring fails here.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:5173/hanzi-trainer/';
const SHOTS = process.env.SHOT_DIR ?? '/tmp/hanzi-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

/** Replays one stroke's median as a mouse gesture in page coordinates. */
async function drawStroke(median) {
  const geom = await page.evaluate(() => {
    const g = document.querySelector('.writer-host svg g[transform]');
    if (!g) return null;
    const m = g.getAttribute('transform').match(/translate\(([-\d.]+),\s*([-\d.]+)\)\s*scale\(([-\d.]+),\s*([-\d.]+)\)/);
    const box = document.querySelector('.writer-host svg').getBoundingClientRect();
    return { tx: +m[1], ty: +m[2], sx: +m[3], sy: +m[4], left: box.left, top: box.top };
  });
  if (!geom) throw new Error('writer svg not mounted');
  const pt = ([mx, my]) => [geom.left + geom.tx + mx * geom.sx, geom.top + geom.ty + my * geom.sy];

  // Interpolate so the gesture has enough samples for the grader.
  const path = [];
  for (let i = 0; i < median.length - 1; i++) {
    const a = median[i], b = median[i + 1];
    for (let t = 0; t < 1; t += 0.2) path.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  path.push(median[median.length - 1]);

  const [x0, y0] = pt(path[0]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (const p of path.slice(1)) {
    const [x, y] = pt(p);
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
  await page.waitForTimeout(90);
}

async function medians(char) {
  return page.evaluate(async (c) => {
    const idx = await fetch('./strokes/chunk-0.json').then((r) => r.json());
    if (idx[c]) return idx[c].medians;
    for (let n = 1; n < 8; n++) {
      const d = await fetch(`./strokes/chunk-${n}.json`).then((r) => r.json());
      if (d[c]) return d[c].medians;
    }
    return null;
  }, char);
}

async function writeCurrentChar(char) {
  const ms = await medians(char);
  if (!ms) throw new Error('no medians for ' + char);
  for (const m of ms) await drawStroke(m);
}

console.log('\nboot');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.dashboard', { timeout: 15000 });
check('dashboard renders', true);
check('next-up list is populated', (await page.locator('.upnext li').count()) > 0);
check('no console errors on boot', errors.length === 0, errors.join(' | '));
await page.screenshot({ path: `${SHOTS}/01-dashboard.png`, fullPage: true });

console.log('\nsession: new character');
await page.getByRole('button', { name: 'Начать занятие' }).click();
await page.waitForSelector('.step.two-col', { timeout: 10000 });
const char = (await page.locator('.col-right .big-char').first().textContent())?.trim();
check('intro shows a character', Boolean(char), char);
check('stroke animation mounted', (await page.locator('.writer-host svg path').count()) > 0);
check('example words shown', (await page.locator('.words li').count()) > 0);
await page.screenshot({ path: `${SHOTS}/02-intro.png`, fullPage: true });

console.log('\nsession: tracing');
await page.getByRole('button', { name: /Понятно/ }).click();
await page.waitForSelector('.step.centered', { timeout: 10000 });
await writeCurrentChar(char);
const nextBtn = page.getByRole('button', { name: /Дальше — по памяти/ });
check('tracing all strokes unlocks the next step', await nextBtn.isEnabled());
await page.screenshot({ path: `${SHOTS}/03-trace.png`, fullPage: true });

console.log('\nsession: writing from memory');
await nextBtn.click();
await page.waitForSelector('.prompt-gloss', { timeout: 10000 });
check('recall prompt hides the character', !(await page.locator('.prompt-gloss').textContent())?.includes(char));
await writeCurrentChar(char);
await page.waitForSelector('.verdict', { timeout: 8000 });
const verdict = (await page.locator('.verdict-head strong').textContent())?.trim();
check('graded verdict appears', Boolean(verdict), verdict);
check('verdict is a pass for a clean trace', /Идеально|Хорошо/.test(verdict ?? ''), verdict);
await page.screenshot({ path: `${SHOTS}/04-recall.png`, fullPage: true });

console.log('\nsession: run to the end');
let guard = 0;
while (guard++ < 250) {
  if (await page.locator('.summary').count()) break;

  if (await page.locator('.quiz-after').count()) {
    await page.getByRole('button', { name: 'Дальше' }).click();
  } else if (await page.locator('.step.quiz').count()) {
    if (!fs.existsSync(`${SHOTS}/05-quiz.png`)) await page.screenshot({ path: `${SHOTS}/05-quiz.png`, fullPage: true });
    await page.locator('.options .option').first().click();
  } else if (await page.locator('.verdict').count()) {
    await page.getByRole('button', { name: 'Дальше' }).click();
  } else if (await page.getByRole('button', { name: /Понятно/ }).count()) {
    await page.getByRole('button', { name: /Понятно/ }).click();
  } else if ((await page.locator('.step-tag').first().textContent())?.includes('Обведи')) {
    await writeCurrentChar(await page.locator('.writer-pad').getAttribute('data-char'));
    await page.getByRole('button', { name: /Дальше — по памяти/ }).click();
  } else if (await page.getByRole('button', { name: 'Не помню' }).count()) {
    // Half the recall steps are answered properly, half given up on, so both
    // the pass path and the "requeue after a failure" path get exercised.
    if (guard % 2 === 0) {
      await writeCurrentChar(await page.locator('.writer-pad').getAttribute('data-char'));
    } else {
      await page.getByRole('button', { name: 'Не помню' }).click();
    }
  } else {
    break;
  }
  await page.waitForTimeout(80);
}
check('session reaches the summary', (await page.locator('.summary').count()) > 0, `after ${guard} actions`);
const learnedStat = await page.locator('.summary-grid .stat').first().textContent();
check('summary counts new characters', /[1-9]/.test(learnedStat ?? ''), learnedStat);
await page.screenshot({ path: `${SHOTS}/05-summary.png`, fullPage: true });

console.log('\npersistence');
await page.getByRole('button', { name: 'На главную' }).click();
await page.waitForSelector('.dashboard');
const before = await page.evaluate(() => document.querySelector('.topstats').textContent);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.dashboard');
const after = await page.evaluate(() => document.querySelector('.topstats').textContent);
check('progress survives a reload', before === after, `${before} vs ${after}`);
check('streak started', /🔥 1/.test(after ?? ''), after);

console.log('\nlibrary');
await page.getByRole('button', { name: 'Иероглифы' }).click();
await page.waitForSelector('.lib-rows');
check('library lists the whole set', (await page.locator('.lib-row').count()) > 100);
await page.locator('.lib-row').first().click();
await page.waitForSelector('.detail-body');
check('detail panel opens', (await page.locator('.card-state').count()) > 0);
await page.locator('.search').fill('shui');
await page.waitForTimeout(200);
check('search by pinyin works', (await page.locator('.lib-row').count()) > 0);
await page.screenshot({ path: `${SHOTS}/06-library.png`, fullPage: true });

console.log('\nsettings');
await page.getByRole('button', { name: 'Настройки' }).click();
await page.waitForSelector('.settings');
await page.screenshot({ path: `${SHOTS}/07-settings.png`, fullPage: true });
check('settings render', true);
check('no console errors overall', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
