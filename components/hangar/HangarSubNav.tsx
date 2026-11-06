'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Phone-only section nav — on desktop the sidebar's Hangar group covers this.
const LINKS = [
  { href: '/hangar', label: 'Board' },
  { href: '/hangar/history', label: 'History' },
  { href: '/hangar/reports', label: 'Reports' },
]

export default function HangarSubNav() {
  const pathname = usePathname()
  return (
    <nav className="seg-track mb-4 sm:hidden" aria-label="Hangar section">
      {LINKS.map((l) => {
        const active = l.href === '/hangar' ? pathname === '/hangar' : pathname.startsWith(l.href)
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={`seg-item ${active ? 'on' : ''}`}
          >
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
