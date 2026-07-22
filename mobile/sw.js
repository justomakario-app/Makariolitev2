/* ══ Macario Lite Mobile — Service Worker mínimo ══
   Estrategia: network-first con fallback a cache para shell.
   No cachea queries de Supabase (siempre van a la red).
*/

const CACHE = 'macario-mobile-v15';
/* M02 (auditoría): el SHELL ya NO precachea archivos versionados (?v=N). Antes la lista quedaba
   congelada en versiones viejas que el index.html actual nunca pedía (offline roto y riesgo de
   servir JS viejo). Ahora se precachea solo el esqueleto sin versión; todos los .jsx/.js/.css
   versionados entran al cache en runtime (network-first) con la URL EXACTA que pide el index. */
const SHELL = [
  '/m/',
  '/m/index.html',
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
      .catch(() => caches.match(e.request).then((m) => {
        if (m) return m;
        // B02: index.html como fallback SOLO para navegación — nunca para .jsx/.css/assets
        // (devolver HTML a Babel/CSS producía errores confusos offline).
        if (e.request.mode === 'navigate') return caches.match('/m/index.html');
        return Response.error();
      }))
  );
});
