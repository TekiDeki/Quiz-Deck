/* Quiz-Deck - TekiDeki
   Cache first, so the app opens with the internet off. Bump VERSION on every
   deploy: the old cache is dropped on activate.

   index.html is the whole application, so one entry covers the game itself.
   The icons are cached for the install prompt. */
const VERSION = 'quiz-deck-v4';
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'favicon.ico',
  'apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) { return; }
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) { return hit; }
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(request, copy));
        return response;
      }).catch(() => caches.match('index.html'));
    })
  );
});
