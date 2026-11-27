const CACHE_NAME = 'ai-music-manager-shell-v14';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/config.js',
  '/app.js',
  '/tiktok-publishing.css',
  '/tiktok-publishing.js',
  '/tiktok-social-mcp.css',
  '/tiktok-social-mcp.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/assets/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Toujours privilégier la version publiée des fichiers qui pilotent l'interface.
  // Le cache ne sert que de secours en cas d'indisponibilité réseau.
  const isAppShell = request.mode === 'navigate' ||
    ['/index.html', '/styles.css', '/config.js', '/app.js',
      '/tiktok-publishing.css', '/tiktok-publishing.js',
      '/tiktok-social-mcp.css', '/tiktok-social-mcp.js', '/pwa.js']
      .includes(url.pathname);

  if (isAppShell) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            const cacheKey = request.mode === 'navigate' ? '/index.html' : request;
            caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) ||
          (request.mode === 'navigate' ? await caches.match('/index.html') : null) ||
          Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
