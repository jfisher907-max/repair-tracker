'use client'

import Link from 'next/link'
import Icon, { type IconName } from '@/components/icons'
import RunningClockBar from '@/components/RunningClockBar'
import SearchEverything from '@/components/SearchEverything'
import WingMark from '@/components/WingMark'
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand'
import { noteVisit, visitFor } from '@/lib/search'
import { usePathname } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'

// Four places in the pill, then two round buttons beside it: Search, and the
// gold New Job (its own button since 2026-11-05). Follow-ups left the pill on
// 2026-11-16 to make the room: it is a door on Home and a "Go to" in Search.
// The icons are the app's own drawings (components/icons.tsx), which replaced
// the emoji the owner's 2026-09-12 rule had allowed here and nowhere else.
const tabs: { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/jobs', label: 'Jobs', icon: 'jobs' },
  { href: '/customers', label: 'People', icon: 'people' },
  { href: '/billing', label: 'Billing', icon: 'billing' },
]

// The desktop sidebar's links are text-led: no icons. Its Search field is the
// one exception, because a magnifier is what says "this is a search field".
const sideNav: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard' }],
  },
  {
    // Quotes live with the work they describe, not with the money: a quote is
    // a job that has not started yet. One door for both (owner rule
    // 2026-09-12); the page's own bar switches between the two lists, and the
    // New Job / New Quote buttons live inside those lists, not in the rail.
    label: 'Work',
    items: [
      { href: '/jobs', label: 'Jobs & Quotes' },
      { href: '/requests', label: 'Requests' },
      { href: '/followups', label: 'Follow-ups' },
    ],
  },
  {
    // Reports is the P&L, cash, sales tax and receivables: money, not overview
    // (owner, 2026-09-12).
    label: 'Money',
    items: [
      { href: '/billing', label: 'Billing' },
      { href: '/reports', label: 'Reports' },
      { href: '/expenses', label: 'Expenses' },
      // Juneau sales-tax returns: the figures, the due date, the record of
      // what was filed and paid (0053). On the phone it is the dashboard's
      // Taxes door (when a return is due) and the Taxes button at its foot.
      { href: '/taxes', label: 'Taxes' },
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
 * Which nav item a route lights up. Every job AND quote route (the two forms
 * included) is "Jobs & Quotes" work; invoice pages count as Billing. New Job
 * left the phone bar for its own button, so /jobs/new lights Jobs there.
 */
function isActive(href: string, pathname: string, surface: 'rail' | 'bar') {
  if (href === '/dashboard') return pathname === '/dashboard'
  if (href === '/jobs/new') return pathname === '/jobs/new'
  if (href === '/hangar') return pathname === '/hangar'
  if (href === '/jobs') {
    if (surface === 'rail' && pathname === '/jobs/new') return false
    return pathname.startsWith('/jobs') || pathname.startsWith('/quotes')
  }
  if (href === '/billing') return pathname.startsWith('/billing') || pathname.startsWith('/invoices')
  return pathname.startsWith(href)
}

/**
 * The floating top-left button: where this page goes back to.
 *
 * Derived from the route rather than registered by each page, so there is one
 * place to read it and no effect ordering to get wrong. Routes that need data
 * to name their parent (an inspection belongs to a job whose id is not in the
 * URL) fall back to the nearest list and keep their own in-content link to
 * the exact parent.
 *
 * null = this page is a destination, not a detail: the Hangar / Settings
 * capsule takes the corner instead.
 */
function backFor(pathname: string): { href: string; label: string } | null {
  const seg = pathname.split('/').filter(Boolean)
  if (seg[0] === 'jobs') {
    if (seg[1] === 'new') return { href: '/jobs', label: 'Jobs' }
    // /jobs/[id]/edit and /jobs/[id]/scan go back to the job itself
    if (seg.length > 2) return { href: `/jobs/${seg[1]}`, label: 'Job' }
    if (seg.length === 2) return { href: '/jobs', label: 'Jobs' }
    return null
  }
  if (seg[0] === 'quotes') return { href: '/jobs?tab=quotes', label: 'Quotes' }
  if (seg[0] === 'invoices') return { href: '/billing', label: 'Billing' }
  if (seg[0] === 'customers' && seg.length > 1) return { href: '/customers', label: 'People' }
  if (seg[0] === 'vehicles') return { href: '/customers', label: 'People' }
  if (seg[0] === 'inspections') return { href: '/jobs', label: 'Jobs' }
  return null
}

/** The floating top-right action, where a page has one of its own. */
function actionFor(pathname: string): { href: string; label: string } | null {
  const seg = pathname.split('/').filter(Boolean)
  // The job page's own Edit, floated (its in-content copy is desktop-only).
  if (seg[0] === 'jobs' && seg.length === 2 && seg[1] !== 'new') {
    return { href: `/jobs/${seg[1]}/edit`, label: 'Edit' }
  }
  return null
}

/** The sidebar links. */
function SideNavLinks({ pathname }: { pathname: string }) {
  return (
    <>
      {sideNav.map((group) => (
        <div key={group.label}>
          <div className="side-label">{group.label}</div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`side-item ${isActive(item.href, pathname, 'rail') ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </>
  )
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
  const back = backFor(pathname)
  const action = actionFor(pathname)

  // Search belongs to the page it was opened on. Any change of page closes it:
  // a result followed, but also the phone's Back gesture, which no button of
  // ours hears. The page is kept beside the flag and the flag is dropped
  // during render when the two disagree, so coming BACK to that page later
  // never finds Search still open on it.
  const [search, setSearch] = useState({ open: false, at: pathname })
  if (search.at !== pathname) setSearch({ open: false, at: pathname })
  const searchOpen = search.open && search.at === pathname
  const openSearch = () => setSearch({ open: true, at: pathname })
  const closeSearch = () => setSearch({ open: false, at: pathname })

  // Ctrl+K (Cmd+K on a Mac) opens and closes it from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearch((s) => ({ open: !(s.open && s.at === pathname), at: pathname }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pathname])

  // Every record he opens is remembered for Search's Recent list (the kind
  // and the id only, on this device).
  useEffect(() => {
    const visit = visitFor(pathname)
    if (visit) noteVisit(visit)
  }, [pathname])

  // The bottom clearance for the floating bar is .app-frame's own rule in
  // globals.css, not a utility here: it has to switch off at sm:, and an
  // inline style could not be overridden.
  return (
    <div className="app-frame min-h-dvh sm:grid sm:grid-cols-[232px_1fr]">
      {/* The lit ground the glass shows through. Owner shell only: the
          customer's quote, invoice and report pages never mount it, and it is
          display:none in print. */}
      <div className="app-lit" aria-hidden="true" />

      {/* Desktop sidebar — the app reads like a real back office on a PC */}
      <aside className="sidebar sticky top-0 hidden h-dvh flex-col overflow-y-auto px-3 py-4 sm:flex">
        <Link href="/dashboard" className="display flex items-center gap-2 px-2 text-xl font-semibold">
          <WingMark size={22} /> {BRAND_NAME}
        </Link>
        {/* Outside the link: the name is the click target, this is a label.
            Desktop only - the phone header is a single row of controls and a
            second line there costs the screen its scarcest space. */}
        <div
          className="px-2 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: 'var(--text3)' }}
        >
          {BRAND_TAGLINE}
        </div>
        <button type="button" className="side-search" onClick={openSearch} aria-haspopup="dialog">
          <Icon name="search" size={16} />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav className="flex-1">
          <SideNavLinks pathname={pathname} />
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

        {/* Phone chrome: floating glass in the top corners, with the page
            scrolling underneath. The old flat .appbar bar is gone — the brand
            is in the sidebar on a desk and in the dashboard's own title on a
            phone, and Home is a tab. */}
        <div className="chrome-corner chrome-corner-l">
          {back ? (
            <Link href={back.href} className="glass-float chrome-btn chrome-solo">
              <span aria-hidden="true">←</span> {back.label}
            </Link>
          ) : (
            <Link
              href="/dashboard"
              className="glass-float chrome-btn chrome-solo"
              aria-label={`${BRAND_NAME} — dashboard`}
            >
              <WingMark size={20} />
            </Link>
          )}
        </div>

        <div className="chrome-corner chrome-corner-r">
          {action ? (
            <Link href={action.href} className="glass-float chrome-btn chrome-solo">
              {action.label}
            </Link>
          ) : (
            <div className="glass-float chrome-capsule">
              <Link
                href="/hangar"
                className={`chrome-btn ${pathname.startsWith('/hangar') ? 'active' : ''}`}
              >
                Hangar
              </Link>
              <Link
                href="/settings"
                className={`chrome-btn ${pathname.startsWith('/settings') ? 'active' : ''}`}
              >
                Settings
              </Link>
            </div>
          )}
        </div>

        {/* Keyed by route so the staggered entrance replays on every navigation.
            The phone's top padding clears the floating corner buttons; content
            still scrolls under them. */}
        <main
          key={pathname}
          className="page-anim mx-auto w-full max-w-5xl p-4 pt-[calc(env(safe-area-inset-top)+64px)] sm:p-6 sm:pt-6"
        >
          {children}
        </main>
      </div>

      {/* A clock left running follows you off the job page. It sizes the
          floating stack itself (--clockbar-h), so the tab bar below and the
          content padding both make room for it. */}
      <RunningClockBar />

      {searchOpen && <SearchEverything onClose={closeSearch} />}

      {/* Phone tab bar: a floating pill set in from both edges, then Search
          and New Job as their own round buttons beside it. */}
      <nav className="tabbar" aria-label="Main">
        <div className="glass-float tabbar-pill">
          {tabs.map((t) => {
            const active = isActive(t.href, pathname, 'bar')
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`tab-item ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={t.icon} className="tab-icon" />
                {t.label}
              </Link>
            )
          })}
        </div>
        <button
          type="button"
          className="glass-float tabbar-search"
          aria-label="Search everything"
          aria-haspopup="dialog"
          onClick={openSearch}
        >
          <Icon name="search" size={24} />
        </button>
        <Link href="/jobs/new" className="tabbar-new" aria-label="New job">
          <Icon name="plus" size={28} />
        </Link>
      </nav>
    </div>
  )
}
