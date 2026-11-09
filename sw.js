/* WG-Putzplan – Service Worker (Offline-Fähigkeit) */
const CACHE = 'wg-putzplan-v9';
const PUSH_CACHE = 'wg-putzplan-push';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PUSH_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---------- Zugangsdaten fuer die Abo-Neu-Anmeldung ---------- */
function credUrl() {
  try { return new URL('./push-cred', self.location.href).href; } catch (e) { return ''; }
}
async function savePushCred(cred) {
  try {
    const cache = await caches.open(PUSH_CACHE);
    await cache.put(new Request(credUrl()), new Response(JSON.stringify(cred), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (e) { /* egal */ }
}
async function readPushCred() {
  try {
    const cache = await caches.open(PUSH_CACHE);
    const res = await cache.match(new Request(credUrl()));
    if (!res) return null;
    return await res.json();
  } catch (e) { return null; }
}

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'WG-PUSH-CRED' && e.data.cred) savePushCred(e.data.cred);
});

/* ---------- Push-Nachrichten (Erinnerungen) ---------- */
function pushIcon(size) {
  try { return new URL('icons/icon-' + size + '.png', self.location.href).href; } catch (e) { return ''; }
}
function pushScopeUrl() {
  try { return new URL('./', self.location.href).href; } catch (e) { return self.location.href; }
}
async function showPushNotification(data) {
  const opts = {
    body: data.body || 'Schau kurz in deinen WG-Putzplan.',
    icon: pushIcon(192),
    badge: pushIcon(192),
    tag: data.tag || 'wg-plan',
    renotify: true,
    data: { url: data.url || pushScopeUrl() }
  };
  try {
    await self.registration.showNotification(data.title || 'WG-Putzplan', opts);
  } catch (e) { /* Anzeige nicht moeglich */ }
  // Offene Apps sofort aktualisieren, statt auf den naechsten Abruf zu warten.
  try {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach((c) => { try { c.postMessage({ type: 'WG-PLAN-CHANGED' }); } catch (e) { /* egal */ } });
  } catch (e) { /* egal */ }
}

self.addEventListener('push', (e) => {
  // Ein kaputter Inhalt darf den Handler nie zum Absturz bringen,
  // sonst geht die Benachrichtigung komplett verloren.
  let data = {};
  try { if (e.data) data = e.data.json() || {}; } catch (err) { data = {}; }
  if (!data.body) {
    try { if (e.data) data.body = e.data.text(); } catch (err2) { /* ignorieren */ }
  }
  e.waitUntil(showPushNotification(data));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || pushScopeUrl();
  e.waitUntil((async () => {
    try {
      const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of list) {
        if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
          try { await c.focus(); } catch (err) { /* ignorieren */ }
          return;
        }
      }
      await clients.openWindow(target);
    } catch (err) { /* ignorieren */ }
  })());
});

// Der Browser hat das Abo erneuert (z. B. nach einer Schluesselrotation).
// Dann muss es beim Server neu angemeldet werden - sonst kommen keine
// Nachrichten mehr an, ohne dass man es merkt.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const cred = await readPushCred();
      if (sub && cred && cred.url && cred.auth) {
        const j = sub.toJSON();
        await fetch(cred.url + '/push/sub', {
          method: 'POST',
          headers: { Authorization: cred.auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: j.endpoint, keys: j.keys,
            dev: cred.dev, hour: cred.hour, tz: cred.tz
          })
        });
      }
      // Offene Seiten Bescheid geben, damit sie den Zustand aktualisieren.
      const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      list.forEach((c) => { try { c.postMessage({ type: 'WG-PUSH-RESUBSCRIBED' }); } catch (e) { /* egal */ } });
    } catch (err) { /* ignorieren */ }
  })());
});

/* stale-while-revalidate: sofort aus dem Cache liefern (offline & schnell),
   im Hintergrund vom Server aktualisieren, damit die nächste Anzeige frisch ist. */
// Nur die App-Dateien werden zwischengespeichert. API-Antworten (Plan, Push)
// duerfen niemals aus dem Cache kommen - sonst liefert der Worker alte Staende
// aus und die Geraete erkennen sich nicht wieder.
const ASSET_PATHS = ASSETS.map((p) => new URL(p, self.location.href).pathname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (ASSET_PATHS.indexOf(url.pathname) === -1) return;

  e.respondWith(
    caches.open(CACHE).then((cache) => {
      const cached = cache.match(req).then((hit) => hit || null);
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(req, res.clone());
        }
        return res;
      }).catch(() => null);

      return cached.then((hit) => {
        if (hit) { network; return hit; }        // Hintergrund-Aktualisierung läuft weiter
        return network.then((res) => res || caches.match('./index.html'));
      });
    })
  );
});
