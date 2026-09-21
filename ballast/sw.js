// Ballast service worker: makes the app installable and usable offline.
// Strategy: same-origin files are network-first (so a new deploy shows up on the next
// load) and fall back to the cache when offline. Fonts and the Firebase SDK scripts are
// cached after first use. Firestore/Auth traffic is never touched.
// Add any new files to CORE below. Bump VERSION if you ever want to force a cache reset.
const VERSION = 'ballast-v1';
const CORE = [
  './', 'index.html', 'manifest.json', 'favicon.svg',
  'css/components.css', 'css/others.css',
  'js/store.js', 'js/firebase-config.js', 'js/sync.js', 'js/state.js', 'js/today.js', 'js/roadmap.js',
  'js/settings.js', 'js/behavior.js', 'js/calendar.js', 'js/main.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];
const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.allSettled(CORE.map(u => c.add(u))))   // one missing file shouldn't block install
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req){
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000));
  // cache:'no-cache' makes the browser revalidate instead of trusting the host's max-age
  const net = fetch(req, { cache: 'no-cache' }).then(res => {
    if(res.ok){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  });
  return Promise.race([net, timeout]).catch(async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if(hit) return hit;
    if(req.mode === 'navigate') return (await caches.match('index.html')) || (await caches.match('./'));
    return net;   // nothing cached: let the network result (or its error) through
  });
}
function staleWhileRevalidate(req){
  return caches.open(VERSION).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(res => { if(res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  });
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if(STATIC_HOSTS.includes(url.hostname)) e.respondWith(staleWhileRevalidate(req));
  // everything else (firestore.googleapis.com, identitytoolkit, ...) goes straight to the network
});
