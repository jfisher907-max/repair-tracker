'use client'

import { useEffect } from 'react'
import { hasStoredSession } from '@/lib/supabase'

/**
 * The public landing owns '/', but the owner's installed PWA and bookmarks
 * still start there. A STORED session means this is the owner's browser —
 * forward to the dashboard so the home-screen icon behaves as it always has.
 *
 * Belt-and-suspenders behind the parse-time inline script on the page (which
 * fires before React even loads); this catches anything that slipped past it.
 * Presence, not a validated session: validation needs the network, and the
 * redirect must work in a dead zone — /dashboard is in the service worker's
 * shell cache precisely for that. AuthGate on the other side is the real
 * validator. Uses location.replace (a navigate-mode request the worker can
 * serve offline), never client routing.
 */
export default function RedirectIfOwner() {
  useEffect(() => {
    if (hasStoredSession()) window.location.replace('/dashboard')
  }, [])

  return null
}
