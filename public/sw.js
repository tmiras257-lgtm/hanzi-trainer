/*
 * Cache-first for everything on this origin, so the trainer keeps working with no
 * network at all once it has been opened. The bundle and the subset font are
 * content-addressed or stable, so serving a cached copy first is safe; new versions
 * arrive on the next load because we also refresh in the background.
 *
 * The cache name is versioned: v1 held the stroke-order data of the handwriting
 * trainer, several megabytes that are now dead weight. Bumping the name drops it.
 */
const CACHE = 'tones-trainer-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([self.registration.scope])).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);

      if (hit) {
        network.catch(() => {});
        return hit;
      }
      return network.then((res) => {
        if (res) return res;
        // A navigation with nothing cached for this exact URL still gets the shell.
        return caches.match(self.registration.scope);
      });
    }),
  );
});
