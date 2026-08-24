'use client'

import { useEffect, useState } from 'react'

/**
 * The unwedge button.
 *
 * An installed PWA can end up holding a stale shell: taps flash their CSS
 * press animation but the router silently fails on chunks that no longer
 * exist, so the app looks alive and goes nowhere. The self-heal in
 * SWRegister only runs in code a wedged browser never loads — this page is
 * the way out, because visiting a fresh URL fetches fresh HTML and fresh JS
 * regardless of what the old shell was holding.
 *
 * Deliberately outside (app) so it needs no layout, no auth, and no data.
 */
export default function ResetPage() {
  const [status, setStatus] = useState('Clearing…')

  useEffect(() => {
    ;(async () => {
      const done: string[] = []
      try {
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((k) => caches.delete(k)))
          done.push(`${keys.length} cache${keys.length === 1 ? '' : 's'}`)
        }
      } catch {}
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations()
          await Promise.all(regs.map((r) => r.unregister()))
          done.push(`${regs.length} worker${regs.length === 1 ? '' : 's'}`)
        }
      } catch {}
      // Sign-in lives in localStorage (supabase-js default; see AuthGate), which
      // this page deliberately never touches — only CacheStorage and service
      // workers are cleared. Do not add localStorage.clear() here: that WOULD
      // log the owner out, breaking the promise printed below.
      setStatus(done.length ? `Cleared ${done.join(' and ')}. Reloading…` : 'Nothing cached. Reloading…')
      setTimeout(() => {
        window.location.replace('/dashboard')
      }, 1200)
    })()
  }, [])

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Resetting the app</h1>
      <p style={{ color: 'var(--text-muted)' }}>{status}</p>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 16 }}>
        Your sign-in and your data are untouched — this only drops the cached copy of the app.
      </p>
    </div>
  )
}
