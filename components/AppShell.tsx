'use client'

import Link from 'next/link'
import WingMark from '@/components/WingMark'
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore } from 'react'

// Five tabs in the pill. New Job is NOT one of them any more: it is its own
// round gold button beside the pill (owner, 2026-11-05), so the pill holds
// only the five places you go, evenly spaced.
const tabs = [
  { href: '/dashboard', label: 'Home', icon: '🏠' },
  { href: '/jobs', label: 'Jobs', icon: '📁' },
  { href: '/customers', label: 'People', icon: '👤' },
  { href: '/billing', label: 'Billing', icon: '🧾' },
  { href: '/followups', label: 'Follow-ups', icon: '🔔' },
]

// The desktop sidebar is text-led: no icons. The phone tab bar (below) keeps
// its emoji — the one place in the app they are allowed (owner rule 2026-09-12).
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

  return (
    <div
      className="app-frame min-h-dvh sm:grid sm:grid-cols-[232px_1fr] sm:pb-0"
      // Clearance for the floating tab bar AND the iPhone home bar, from the
      // one token that also sizes the bar. sm:pb-0 drops it on a desk, where
      // the bar is not there.
      style={{ paddingBottom: 'var(--tabbar-clear)' }}
    >
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
        <nav className="mt-2 flex-1">
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
        <div className="chrome-corner chrome-corner-l sm:hidden">
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

        <div className="chrome-corner chrome-corner-r sm:hidden">
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

      {/* Phone tab bar: a floating pill set in from both edges, with New Job
          as its own round gold button beside it. */}
      <nav className="tabbar sm:hidden" aria-label="Main">
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
                <span className="tab-icon" aria-hidden="true">
                  {t.icon}
                </span>
                {t.label}
              </Link>
            )
          })}
        </div>
        <Link href="/jobs/new" className="tabbar-new" aria-label="New job">
          <span aria-hidden="true">+</span>
        </Link>
      </nav>
    </div>
  )
}
