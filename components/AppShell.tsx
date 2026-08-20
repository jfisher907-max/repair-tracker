'use client'

import Link from 'next/link'
import WingMark from '@/components/WingMark'
import { BRAND_NAME } from '@/lib/brand'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const tabs = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/jobs', label: 'Jobs', icon: '🗂️' },
  { href: '/jobs/new', label: 'New Job', icon: '➕', primary: true },
  { href: '/customers', label: 'People', icon: '👤' },
  { href: '/billing', label: 'Billing', icon: '🧾' },
  { href: '/followups', label: 'Follow-ups', icon: '🔔' },
]

const sideNav: { label: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Dashboard', icon: '🏠' },
      { href: '/reports', label: 'Reports', icon: '📊' },
    ],
  },
  {
    label: 'Work',
    items: [
      { href: '/jobs', label: 'Jobs', icon: '🗂️' },
      { href: '/jobs/new', label: 'New Job', icon: '➕' },
      { href: '/followups', label: 'Follow-ups', icon: '🔔' },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/billing', label: 'Quotes & Invoices', icon: '🧾' },
      { href: '/quotes/new', label: 'New Quote', icon: '📝' },
      { href: '/expenses', label: 'Expenses', icon: '🧰' },
    ],
  },
  { label: 'People', items: [{ href: '/customers', label: 'Customers', icon: '👤' }] },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [online, setOnline] = useState(true)

  useEffect(() => {
    setOnline(navigator.onLine)
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    if (href === '/jobs/new') return pathname === '/jobs/new'
    if (href === '/quotes/new') return pathname === '/quotes/new'
    if (href === '/jobs') return pathname.startsWith('/jobs') && pathname !== '/jobs/new'
    if (href === '/billing') {
      return (
        pathname.startsWith('/billing') ||
        (pathname.startsWith('/quotes') && pathname !== '/quotes/new') ||
        pathname.startsWith('/invoices')
      )
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="app-frame min-h-dvh pb-24 sm:grid sm:grid-cols-[232px_1fr] sm:pb-0">
      {/* Desktop sidebar — the app reads like a real back office on a PC */}
      <aside className="sidebar sticky top-0 hidden h-dvh flex-col px-3 py-4 sm:flex">
        <Link href="/" className="display flex items-center gap-2 px-2 text-xl font-semibold">
          <WingMark size={22} /> {BRAND_NAME}
        </Link>
        <nav className="mt-2 flex-1">
          {sideNav.map((group) => (
            <div key={group.label}>
              <div className="side-label">{group.label}</div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`side-item ${isActive(item.href) ? 'active' : ''}`}
                >
                  <span className="text-base leading-none">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <Link
          href="/settings"
          className={`side-item ${pathname.startsWith('/settings') ? 'active' : ''}`}
        >
          <span className="text-base leading-none">⚙️</span>
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

        {/* Phone header (desktop brand lives in the sidebar) */}
        <header className="appbar sticky top-0 z-40 flex items-center justify-between px-4 pb-3 sm:hidden">
          <Link href="/" className="display flex items-center gap-2 text-xl font-semibold">
            <WingMark size={22} /> {BRAND_NAME}
          </Link>
          <Link
            href="/settings"
            className="text-2xl transition-opacity"
            aria-label="Settings"
            style={{ opacity: pathname.startsWith('/settings') ? 1 : 0.6 }}
          >
            ⚙️
          </Link>
        </header>

        {/* Keyed by route so the staggered entrance replays on every navigation */}
        <main key={pathname} className="page-anim mx-auto w-full max-w-5xl p-4 sm:p-6">
          {children}
        </main>
      </div>

      {/* Phone bottom tab bar */}
      <nav className="tabbar fixed inset-x-0 bottom-0 z-40 flex sm:hidden">
        {tabs.map((t) => {
          const active = isActive(t.href)
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
