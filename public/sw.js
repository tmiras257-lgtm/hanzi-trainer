/*
 * Kill switch.
 *
 * The previous version of this file was cache-first over every GET on the
 * origin. That is fine until the build changes: a returning browser kept
 * serving the old cached index.html, which points at a hashed bundle that no
 * longer exists on the server, so the page rendered nothing at all. Bumping the
 * cache name did not help — the old worker stays in control, so the new
 * worker's cleanup never runs.
 *
 * This worker therefore does one thing: remove every cache, unregister itself,
 * and reload whatever windows it was controlling. After that the site is served
 * plainly by the network and the browser's own HTTP cache, which is all a small
 * static bundle needed in the first place.
 *
 * It deliberately has no fetch handler, so while it is alive nothing is
 * intercepted.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* nothing cached, or storage blocked */
      }

      try {
        await self.registration.unregister();
      } catch {
        /* already gone */
      }

      // Windows still showing the stale shell get one reload. This cannot loop:
      // the registration is gone, so the reloaded page has no worker at all.
      try {
        const windows = await self.clients.matchAll({ type: 'window' });
        for (const client of windows) {
          if ('navigate' in client) await client.navigate(client.url);
        }
      } catch {
        /* client navigation not permitted */
      }
    })(),
  );
});
