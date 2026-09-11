/*
 * Regression test for the failure that took the live site down after the
 * rewrite: a service worker outliving its build.
 *
 * The old worker was cache-first over every GET, so a returning browser was
 * served a cached index.html pointing at a hashed bundle that no longer existed
 * on the server. The page rendered nothing. Bumping the cache name did not help,
 * because the old worker stays in control and the new worker's cleanup never runs.
 *
 * This puts a browser back into that exact state and checks that the current
 * sw.js digs it out: caches gone, registration gone, app rendering again.
 *
 * Needs a preview server on the built site: npx vite preview --port 4173
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.APP_URL ?? 'http://localhost:4173/hanzi-trainer/';
const DIST_SW = path.join(ROOT, 'dist/sw.js');
const CURRENT_SW = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');

/* The shipped worker as of the handwriting build: cache-first over everything. */
const LEGACY_SW = `
const CACHE = 'hanzi-trainer-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
`;

let failures = 0;
const check = (n, ok, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${extra ? ' - ' + extra : ''}`);
  if (!ok) failures++;
};

if (!fs.existsSync(DIST_SW)) {
  console.error('dist/sw.js missing — run `npm run build` first');
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

try {
  // 1. Restore the old worker and a stale shell that points at a dead bundle.
  fs.writeFileSync(DIST_SW, LEGACY_SW);
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
    await navigator.serviceWorker.register('sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
  });
  await page.evaluate(async () => {
    const c = await caches.open('hanzi-trainer-v1');
    await c.put(
      location.href,
      new Response(
        '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ханьцзы</title></head>' +
          '<body><div id="root"></div><script type="module" src="assets/index-DEADBEEF.js"></script></body></html>',
        { headers: { 'content-type': 'text/html' } },
      ),
    );
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const broken = await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? -1);
  check('stale worker does break the page', broken <= 0, `#root length ${broken}`);

  // 2. Ship the current worker; the next visit must recover on its own.
  fs.writeFileSync(DIST_SW, CURRENT_SW);
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 100, null, { timeout: 20000 })
    .catch(() => {});

  const rendered = await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? -1);
  check('app renders again', rendered > 100, `#root length ${rendered}`);

  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  check('worker unregistered itself', regs === 0, `${regs} left`);

  const keys = await page.evaluate(() => caches.keys());
  check('caches cleared', keys.length === 0, JSON.stringify(keys));

  await page.reload({ waitUntil: 'networkidle' });
  const after = await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? -1);
  check('healthy on the following visit', after > 100, `#root length ${after}`);
} finally {
  fs.writeFileSync(DIST_SW, CURRENT_SW);
  await browser.close();
}

console.log(failures ? `\n${failures} failing check(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
