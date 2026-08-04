'use client'

import { useEffect } from 'react'

export default function SWRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return

    let reloaded = false
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for a new deploy now and whenever the app is foregrounded —
        // this is how updates reach a phone that never gets a hard refresh.
        reg.update().catch(() => {})
        const onVisible = () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {})
        }
        document.addEventListener('visibilitychange', onVisible)
      })
      .catch(() => {
        // Registration failure is non-fatal — the app just loses shell caching.
      })

    // When the new worker takes control, reload once so the fresh build renders.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    })
  }, [])
  return null
}
