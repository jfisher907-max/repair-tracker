'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Customer link pages. Someone opening a texted quote is a one-off visitor —
 * they get no benefit from the shop's app shell, so they never get the worker.
 */
const CUSTOMER_PREFIXES = ['/q/', '/i/', '/s/']

/** At most one reload a minute, so a reload can never chain into a loop. */
const RELOAD_COOLDOWN_MS = 60_000

export default function SWRegister() {
  const pathname = usePathname()
  const isCustomerPage = CUSTOMER_PREFIXES.some((p) => pathname?.startsWith(p))

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (isCustomerPage) {
      // Undo it for anyone who already picked the worker up: while it's
      // registered it keeps claiming their tab, and every claim used to
      // reload the page. Unregistering is enough — leave the caches alone so
      // the owner's installed app doesn't lose its shell.
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {})
      return
    }

    if (process.env.NODE_ENV !== 'production') return

    // Reload ONLY when a new worker replaces one that was already in control.
    // On a first install there is nothing stale on screen to refresh, and
    // reloading there turns any browser that fails to persist the worker
    // (private mode, iOS storage eviction) into a permanent refresh loop.
    const hadController = !!navigator.serviceWorker.controller
    const onControllerChange = () => {
      if (!hadController) return
      let last = 0
      try {
        last = Number(sessionStorage.getItem('sw-reloaded-at') || 0)
      } catch {}
      if (Date.now() - last < RELOAD_COOLDOWN_MS) return
      try {
        sessionStorage.setItem('sw-reloaded-at', String(Date.now()))
      } catch {}
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    let removeVisibility = () => {}
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
        removeVisibility = () => document.removeEventListener('visibilitychange', onVisible)
      })
      .catch(() => {
        // Registration failure is non-fatal — the app just loses shell caching.
      })

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      removeVisibility()
    }
  }, [isCustomerPage])

  return null
}
