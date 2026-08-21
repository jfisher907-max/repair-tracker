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

/**
 * A dead app looks alive: press animations are CSS, so taps still flash while
 * the router silently fails on a chunk that no longer exists (yesterday's
 * cached shell against today's deploy). Recover once, automatically, instead
 * of leaving the owner tapping a screen that goes nowhere.
 */
function isStaleBundleError(message: string): boolean {
  return (
    /ChunkLoadError|Loading chunk \d+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
      message,
    )
  )
}

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

    // Self-heal a wedged bundle: drop the caches and the worker, then reload
    // once (the cooldown key is shared with the update reload, so the two can
    // never ping-pong).
    async function recoverFromStaleBundle() {
      let last = 0
      try {
        last = Number(sessionStorage.getItem('sw-reloaded-at') || 0)
      } catch {}
      if (Date.now() - last < RELOAD_COOLDOWN_MS) return
      try {
        sessionStorage.setItem('sw-reloaded-at', String(Date.now()))
      } catch {}
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      } catch {}
      window.location.reload()
    }
    const onError = (e: ErrorEvent) => {
      if (isStaleBundleError(String(e.message ?? ''))) recoverFromStaleBundle()
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason
      const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
      if (isStaleBundleError(msg)) recoverFromStaleBundle()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

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
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      removeVisibility()
    }
  }, [isCustomerPage])

  return null
}
