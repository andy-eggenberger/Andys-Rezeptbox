const CACHE = 'andys-rezeptbox-v3-17-cache-2';
const FILES = ['./','./index.html','./styles.css','./app.js','./manifest.webmanifest'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});
self.addEventListener('activate', e => e.waitUntil(
  Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))),
    self.clients.claim()
  ])
));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // NAS-Anfragen, POST-Daten und andere externe Zugriffe niemals im
  // öffentlichen App-Cache speichern oder durch alte Antworten ersetzen.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
