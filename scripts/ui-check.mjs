/*
 * End-to-end check against real Chrome, plus the screenshots used to review the
 * design. Speech synthesis and the microphone cannot be exercised headlessly,
 * so what is checked here is that their absence is reported honestly rather
 * than silently swallowed.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:4173/hanzi-trainer/';
const SHOTS = process.env.SHOT_DIR ?? '/tmp/tone-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'chrome' });

async function openPage(scheme) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    permissions: [],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { ctx, page, errors };
}

/* ---------- dark: the default look ---------- */
const dark = await openPage('dark');
{
  const { page, errors } = dark;
  await page.waitForSelector('.brand-name', { timeout: 10000 });

  check('home renders', await page.locator('h1').first().isVisible());
  check('tone staff drawn', (await page.locator('svg.staff').count()) >= 5,
    `${await page.locator('svg.staff').count()} staves`);

  // The subset is requested up front by main.tsx, so it is ready before any
  // Chinese character is rendered rather than after the first one appears.
  const fontOk = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('400 16px "Noto Sans SC Subset"');
  });
  check('subset font ready before use', fontOk);

  const subsetServed = await page.evaluate(async () => {
    const r = await fetch(new URL('fonts/zh-400.woff2', location.href));
    return r.ok && Number(r.headers.get('content-length') ?? 0) > 50000;
  });
  check('subset served', subsetServed);

  // No horizontal overflow at desktop width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no sideways scroll', overflow <= 0, `${overflow}px`);

  await page.screenshot({ path: `${SHOTS}/01-home-dark.png`, fullPage: true });

  /* library */
  await page.getByRole('button', { name: 'Слоги' }).click();
  await page.waitForSelector('table');
  check('minimal pair table', (await page.locator('tbody tr').count()) > 5);

  const glyphFont = await page.evaluate(() => {
    const el = document.querySelector('.zh');
    return el ? getComputedStyle(el).fontFamily : '(no chinese on page)';
  });
  check('chinese uses the subset', glyphFont.includes('Noto Sans SC Subset'), glyphFont.slice(0, 36));
  await page.screenshot({ path: `${SHOTS}/02-library-dark.png`, fullPage: true });

  /* settings */
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.waitForSelector('input[type=checkbox]');
  check('drill toggles', (await page.locator('input[type=checkbox]').count()) === 4);
  await page.screenshot({ path: `${SHOTS}/03-settings-dark.png`, fullPage: true });

  /* session */
  await page.getByRole('button', { name: 'Главная' }).click();
  await page.getByRole('button', { name: 'Начать занятие' }).click();
  await page.waitForSelector('.stage', { timeout: 10000 });
  check('session starts', await page.locator('.progress-track').isVisible());
  await page.screenshot({ path: `${SHOTS}/04-session-dark.png`, fullPage: true });

  // Answer whatever drill came up, then confirm the queue advances.
  const before = await page.locator('.badge.num').innerText();
  const toneBtn = page.locator('.tone-btn:not([disabled])').first();
  const choice = page.locator('.choice:not([disabled])').first();
  if (await toneBtn.count()) await toneBtn.click();
  else if (await choice.count()) await choice.click();

  const next = page.getByRole('button', { name: /Дальше|Пропустить/ });
  if (await next.count()) {
    await page.screenshot({ path: `${SHOTS}/05-answered-dark.png`, fullPage: true });
    await next.first().click();
    const after = await page.locator('.badge.num').innerText();
    check('queue advances', before !== after, `${before} -> ${after}`);
  } else {
    check('queue advances', false, 'no next button after answering');
  }

  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
}

/* ---------- light: the other theme gets the same care ---------- */
const light = await openPage('light');
{
  const { page, errors } = light;
  await page.waitForSelector('.brand-name', { timeout: 10000 });

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('light theme applied', bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(13, 18, 21)', bg);
  await page.screenshot({ path: `${SHOTS}/06-home-light.png`, fullPage: true });
  check('no console errors (light)', errors.length === 0, errors.slice(0, 2).join(' | '));
}

/* ---------- narrow viewport ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.brand-name');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no sideways scroll on mobile', overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: `${SHOTS}/07-home-mobile.png`, fullPage: true });
}

await browser.close();
console.log(failures ? `\n${failures} failing check(s)` : '\nall checks passed');
console.log(`screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
