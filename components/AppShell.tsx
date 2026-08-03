'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const tabs = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/jobs', label: 'Jobs', icon: '🗂️' },
  { href: '/jobs/new', label: 'New Job', icon: '➕', primary: true },
  { href: '/billing', label: 'Billing', icon: '🧾' },
  { href: '/customers', label: 'Customers', icon: '👤' },
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
    if (href === '/jobs') return pathname.startsWith('/jobs') && pathname !== '/jobs/new'
    if (href === '/billing') {
      return (
        pathname.startsWith('/billing') ||
        pathname.startsWith('/quotes') ||
        pathname.startsWith('/invoices')
      )
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-dvh pb-24 sm:pb-8">
      {!online && (
        <div
          className="flash-in sticky top-0 z-50 px-4 py-2 text-center text-sm font-semibold"
          style={{ background: 'var(--red)', color: '#2b0d0d' }}
        >
          No connection — changes won&apos;t save until you&apos;re back online.
        </div>
      )}
      <header className="appbar sticky top-0 z-40 flex items-center justify-between px-4 pb-3">
        <Link href="/" className="text-xl display font-semibold">
          🔧 Repair Tracker
        </Link>
        {/* Desktop nav */}
        <nav className="hidden gap-1 sm:flex">
          {[...tabs, { href: '/settings', label: 'Settings', icon: '⚙️', primary: false }].map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={t.primary ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
              style={
                t.primary
                  ? undefined
                  : isActive(t.href)
                    ? { borderColor: 'var(--accent)', color: 'var(--accent2)', background: 'transparent' }
                    : { border: '1px solid transparent', background: 'transparent' }
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {/* Settings lives in the header on phones to keep the tab bar to five */}
        <Link
          href="/settings"
          className="text-2xl transition-opacity sm:hidden"
          aria-label="Settings"
          style={{ opacity: pathname.startsWith('/settings') ? 1 : 0.6 }}
        >
          ⚙️
        </Link>
      </header>

      {/* Keyed by route so the staggered entrance replays on every navigation */}
      <main key={pathname} className="page-anim mx-auto w-full max-w-5xl p-4">
        {children}
      </main>

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
