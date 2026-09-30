self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Ignore non-http/https schemes (e.g. chrome-extension://)
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Bypass service worker for video/audio streaming range requests and backend API calls
  if (
    e.request.headers.get('range') ||
    url.pathname.startsWith('/api/') ||
    e.request.destination === 'video' ||
    e.request.destination === 'audio'
  ) {
    return;
  }

  e.respondWith(
    fetch(e.request).catch(() => {
      // Gracefully handle network drops without throwing uncaught promises in console
      return new Response(null, { status: 504, statusText: 'Offline or Network Interrupted' });
    })
  );
});
