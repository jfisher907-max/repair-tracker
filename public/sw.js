// App-shell caching only. Full offline sync is out of scope (v1) — the goal is
// instant open + a graceful failure when there's no connection.
// Bump CACHE on strategy changes; SWRegister reloads the page once when a new
// worker takes over, so deploys reach open tabs without a manual hard-refresh.
const CACHE = 'repair-tracker-v2'
const SHELL = ['/', '/manifest.webmanifest', '/icon', '/icon-192', '/apple-icon']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Never intercept API calls — data must always be live.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    // Network-first for pages; fall back to the cached shell when offline.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return res
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/'))),
    )
    return
  }

  // Static assets: stale-while-revalidate — serve instantly from cache, but
  // refresh the cached copy in the background so updates never get pinned.
  event.respondWith(
    caches.match(request).then((hit) => {
      const refresh = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return res
        })
        .catch(() => hit)
      return hit || refresh
    }),
  )
})
