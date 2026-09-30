// public/sw.js
// ClipGrab Service Worker — Offline Shell, Static Asset Cache & Offline Recovery

const CACHE_NAME = 'clipgrab-offline-v3';
const STATIC_ASSETS = [
  '/',
  '/site.webmanifest',
  '/favicon.svg',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-caching non-fatal warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignore non-http/https schemes (e.g. chrome-extension://, blob:, data:)
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 1. Bypass Service Worker for video/audio streaming range requests,
  // API requests, or Colab tunnel requests
  if (
    event.request.headers.get('range') ||
    url.pathname.startsWith('/api/') ||
    event.request.destination === 'video' ||
    event.request.destination === 'audio'
  ) {
    return;
  }

  // 2. Navigation requests (HTML documents like visiting / or any page)
  // Strategy: Network-first, fallback to cached HTML
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
              cache.put('/', networkResponse.clone()); // keep root page updated
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Device is OFFLINE: serve cached document
          const cachedPage = await caches.match(event.request);
          if (cachedPage) return cachedPage;

          const rootPage = await caches.match('/');
          if (rootPage) return rootPage;

          // If never cached before, return a clean offline fallback HTML
          return new Response(
            `<!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="utf-8"/>
              <meta name="viewport" content="width=device-width, initial-scale=1"/>
              <title>ClipGrab — Offline Mode</title>
              <style>
                body { background: #07080d; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }
                .card { max-width: 440px; width: 100%; padding: 32px 24px; border-radius: 24px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
                h1 { font-size: 22px; font-weight: 800; margin: 0 0 10px; color: #fff; }
                p { font-size: 14px; color: rgba(255,255,255,0.6); line-height: 1.6; margin: 0 0 24px; }
                .btn { display: inline-flex; align-items: center; justify-content: center; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 14px; font-weight: 700; font-size: 14px; border: none; cursor: pointer; transition: 0.2s; }
                .btn:hover { background: #4f46e5; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>⚡ ClipGrab Offline</h1>
                <p>You are currently offline. Connect to the internet once to synchronize, or reload the page.</p>
                <button class="btn" onclick="window.location.reload()">Reload App</button>
              </div>
            </body>
            </html>`,
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // 3. Static assets: Next.js bundles, CSS, JS, fonts, images
  // Strategy: Cache-first with network background revalidation
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2') ||
    event.request.destination === 'style' ||
    event.request.destination === 'script' ||
    event.request.destination === 'image' ||
    event.request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // In background, fetch fresh copy if online to keep cache up-to-date
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        // Cache miss: fetch from network and store in cache
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => {
            // Return empty 200 instead of 504 to prevent browser error screens
            return new Response('', { status: 200, statusText: 'Offline Fallback' });
          });
      })
    );
    return;
  }

  // 4. Default strategy for any other requests (Network first with cache fallback)
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response(null, { status: 200, statusText: 'Offline Handled' });
      })
  );
});
