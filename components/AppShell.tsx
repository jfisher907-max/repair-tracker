'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const tabs = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/jobs', label: 'Jobs', icon: '🗂️' },
  { href: '/jobs/new', label: 'New Job', icon: '➕', primary: true },
  { href: '/customers', label: 'Customers', icon: '👤' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
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
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-dvh pb-24 sm:pb-8">
      {!online && (
        <div
          className="sticky top-0 z-50 px-4 py-2 text-center text-sm font-semibold"
          style={{ background: 'var(--red)', color: '#2b0d0d' }}
        >
          No connection — changes won&apos;t save until you&apos;re back online.
        </div>
      )}
      <header
        className="sticky top-0 z-40 border-b px-4 py-3 sm:flex sm:items-center sm:justify-between"
        style={{ background: 'var(--bg1)', borderColor: 'var(--border)' }}
      >
        <Link href="/" className="text-xl display font-semibold">
          🔧 Repair Tracker
        </Link>
        {/* Desktop nav */}
        <nav className="hidden gap-1 sm:flex">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="btn btn-sm"
              style={
                t.primary
                  ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#201503' }
                  : isActive(t.href)
                    ? { borderColor: 'var(--accent)', color: 'var(--accent2)' }
                    : { border: '1px solid transparent', background: 'transparent' }
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl p-4">{children}</main>

      {/* Phone bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t sm:hidden"
        style={{
          background: 'var(--bg1)',
          borderColor: 'var(--border)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[0.65rem] font-semibold"
            style={
              t.primary
                ? { color: 'var(--accent)' }
                : { color: isActive(t.href) ? 'var(--accent2)' : 'var(--text3)' }
            }
          >
            <span className={t.primary ? 'text-2xl leading-none' : 'text-lg leading-none'}>
              {t.icon}
            </span>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
