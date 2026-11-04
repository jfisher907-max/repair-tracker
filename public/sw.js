// App-shell caching only. Full offline sync is out of scope (v1) — the goal is
// instant open + a graceful failure when there's no connection.
// Bump CACHE on strategy changes; SWRegister reloads the page once when a new
// worker takes over, so deploys reach open tabs without a manual hard-refresh.
const CACHE = 'wings-n-things-v5'
// The shell is the OWNER'S app. '/' is the public landing page now — the
// worker only ever runs for a signed-in owner (SWRegister gates on session),
// so the offline fallback is the dashboard, never the marketing page.
const SHELL = ['/dashboard', '/manifest.webmanifest', '/icon', '/icon-192', '/apple-icon']

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
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/dashboard'))),
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

// Push alerts (migration 0068): /api/request pushes { title, body, url, tag }
// when a customer submits the Request service form.
self.addEventListener('push', (event) => {
  let msg = {}
  try {
    msg = event.data ? event.data.json() : {}
  } catch {
    msg = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || 'New service request', {
      body: msg.body || 'Open the app to see it.',
      icon: '/icon-192',
      badge: '/icon-192',
      tag: msg.tag || 'service-request',
      renotify: true,
      data: { url: msg.url || '/requests' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = (event.notification.data && event.notification.data.url) || '/requests'
  const target = new URL(path, self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Reuse an open app window when there is one; otherwise open the app.
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(target) : w))
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
