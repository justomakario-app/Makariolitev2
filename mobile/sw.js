/* ══ Macario Lite Mobile — Service Worker mínimo ══
   Estrategia: network-first con fallback a cache para shell.
   No cachea queries de Supabase (siempre van a la red).
*/

const CACHE = 'macario-mobile-v1';
const SHELL = [
  '/m/',
  '/m/index.html',
  '/m/components/styles.css',
  '/m/components/mobile.css',
  '/m/components/data.js?v=2',
  '/m/components/shared.jsx?v=11',
  '/m/components/login.jsx?v=11',
  '/m/components/bottombar.jsx?v=1',
  '/m/components/dashboard.jsx?v=1',
  '/m/components/carrier.jsx?v=1',
  '/m/components/produccion.jsx?v=1',
  '/m/components/scan.jsx?v=1',
  '/m/components/modals.jsx?v=11',
  '/m/components/pages.jsx?v=1',
  '/m/components/app.jsx?v=1',
  '/m/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch((err) => console.warn('SW pre-cache fail:', err)))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Nunca interceptar Supabase ni APIs externas
  if (url.hostname.includes('supabase.co')
      || url.hostname.includes('jsdelivr.net')
      || url.hostname.includes('unpkg.com')
      || url.hostname.includes('googleapis.com')
      || url.hostname.includes('gstatic.com')) {
    return;
  }

  // Solo el scope /m/
  if (!url.pathname.startsWith('/m/')) return;

  // Network-first con fallback a cache
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok && e.request.method === 'GET') {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('/m/index.html')))
  );
});
