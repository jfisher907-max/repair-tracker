'use client'

import Link from 'next/link'
import WingMark from '@/components/WingMark'
import { BRAND_NAME } from '@/lib/brand'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useSyncExternalStore } from 'react'

const tabs = [
  { href: '/dashboard', label: 'Home', icon: '🏠' },
  { href: '/jobs', label: 'Jobs', icon: '📁' },
  { href: '/jobs/new', label: 'New Job', icon: '➕', primary: true },
  { href: '/customers', label: 'People', icon: '👤' },
  { href: '/billing', label: 'Billing', icon: '🧾' },
  { href: '/followups', label: 'Follow-ups', icon: '🔔' },
]

// The desktop sidebar is text-led: no icons. The phone tab bar (below) keeps
// its emoji — the one place in the app they are allowed (owner rule 2026-09-12).
const sideNav: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/reports', label: 'Reports' },
    ],
  },
  {
    // Quotes live with the work they describe, not with the money: a quote is
    // a job that has not started yet.
    label: 'Work',
    items: [
      { href: '/jobs', label: 'Jobs' },
      { href: '/jobs/new', label: 'New Job' },
      { href: '/jobs?tab=quotes', label: 'Quotes' },
      { href: '/quotes/new', label: 'New Quote' },
      { href: '/requests', label: 'Requests' },
      { href: '/followups', label: 'Follow-ups' },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/billing', label: 'Billing' },
      { href: '/expenses', label: 'Expenses' },
    ],
  },
  { label: 'People', items: [{ href: '/customers', label: 'Customers' }] },
  {
    // Hangar management for Airlift Northwest — deliberately its own group so it
    // stays out of the repair lanes above.
    label: 'Hangar',
    items: [
      { href: '/hangar', label: 'Board' },
      { href: '/hangar/history', label: 'History' },
      { href: '/hangar/reports', label: 'Reports' },
    ],
  },
]

/**
 * Which nav item a route lights up. `tab` is the ?tab= of the current URL
 * (null when the caller cannot read it) — it only matters on /jobs, where
 * ?tab=quotes lights "Quotes" instead of "Jobs".
 *
 * Quote pages count as Jobs work (the phone tab bar has no Quotes tab), and
 * invoice pages count as Billing.
 */
function isActive(href: string, pathname: string, tab: string | null) {
  const onQuotesTab = pathname === '/jobs' && tab === 'quotes'
  const onQuotePage = pathname.startsWith('/quotes') && pathname !== '/quotes/new'
  if (href === '/dashboard') return pathname === '/dashboard'
  if (href === '/jobs/new') return pathname === '/jobs/new'
  if (href === '/quotes/new') return pathname === '/quotes/new'
  if (href === '/hangar') return pathname === '/hangar'
  if (href === '/jobs?tab=quotes') return onQuotesTab || onQuotePage
  if (href === '/jobs') {
    // The sidebar (tab known) hands quote routes to its own "Quotes" item; the
    // phone tab bar (tab unknown) has no such item, so Jobs takes them.
    if (tab !== null && (onQuotesTab || onQuotePage)) return false
    return (pathname.startsWith('/jobs') && pathname !== '/jobs/new') || onQuotePage
  }
  if (href === '/billing') return pathname.startsWith('/billing') || pathname.startsWith('/invoices')
  return pathname.startsWith(href)
}

/** The sidebar links. Split out so the search-param read sits under its own
 *  Suspense boundary instead of bailing the whole shell out of prerendering. */
function SideNavLinks({ pathname, tab }: { pathname: string; tab: string | null }) {
  return (
    <>
      {sideNav.map((group) => (
        <div key={group.label}>
          <div className="side-label">{group.label}</div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`side-item ${isActive(item.href, pathname, tab) ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </>
  )
}

function SideNavWithParams({ pathname }: { pathname: string }) {
  const params = useSearchParams()
  return <SideNavLinks pathname={pathname} tab={params.get('tab') ?? ''} />
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // The server render has no navigator, so it assumes online; the client
  // reads the real value on hydration.
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)

  return (
    <div className="app-frame min-h-dvh pb-24 sm:grid sm:grid-cols-[232px_1fr] sm:pb-0">
      {/* Desktop sidebar — the app reads like a real back office on a PC */}
      <aside className="sidebar sticky top-0 hidden h-dvh flex-col overflow-y-auto px-3 py-4 sm:flex">
        <Link href="/dashboard" className="display flex items-center gap-2 px-2 text-xl font-semibold">
          <WingMark size={22} /> {BRAND_NAME}
        </Link>
        <nav className="mt-2 flex-1">
          <Suspense fallback={<SideNavLinks pathname={pathname} tab={null} />}>
            <SideNavWithParams pathname={pathname} />
          </Suspense>
        </nav>
        <Link
          href="/settings"
          className={`side-item ${pathname.startsWith('/settings') ? 'active' : ''}`}
        >
          Settings
        </Link>
      </aside>

      <div className="min-w-0">
        {!online && (
          <div
            className="flash-in sticky top-0 z-50 px-4 py-2 text-center text-sm font-semibold"
            style={{ background: 'var(--red)', color: '#2b0d0d' }}
          >
            No connection — changes won&apos;t save until you&apos;re back online.
          </div>
        )}

        {/* Phone header (desktop brand lives in the sidebar). Text links, not
            icons: the tab bar below is the only place emoji are allowed. */}
        <header className="appbar sticky top-0 z-40 flex items-center justify-between px-4 pb-3 sm:hidden">
          <Link href="/dashboard" className="display flex items-center gap-2 text-xl font-semibold">
            <WingMark size={22} /> {BRAND_NAME}
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/hangar"
              className="flex min-h-[44px] items-center px-2 text-sm font-semibold transition-opacity"
              style={{ opacity: pathname.startsWith('/hangar') ? 1 : 0.6 }}
            >
              Hangar
            </Link>
            <Link
              href="/settings"
              className="-mr-2 flex min-h-[44px] items-center px-2 text-sm font-semibold transition-opacity"
              style={{ opacity: pathname.startsWith('/settings') ? 1 : 0.6 }}
            >
              Settings
            </Link>
          </div>
        </header>

        {/* Keyed by route so the staggered entrance replays on every navigation */}
        <main key={pathname} className="page-anim mx-auto w-full max-w-5xl p-4 sm:p-6">
          {children}
        </main>
      </div>

      {/* Phone bottom tab bar */}
      <nav className="tabbar fixed inset-x-0 bottom-0 z-40 flex sm:hidden">
        {tabs.map((t) => {
          const active = isActive(t.href, pathname, null)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`tab-item flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[0.65rem] font-semibold ${active ? 'active' : ''}`}
              style={
                t.primary
                  ? { color: 'var(--accent)' }
                  : { color: active ? 'var(--accent2)' : 'var(--text3)' }
              }
            >
              <span className={`tab-icon ${t.primary ? 'text-2xl' : 'text-lg'} leading-none`}>
                {t.icon}
              </span>
              {t.label}
              <span className="tab-dot" />
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
