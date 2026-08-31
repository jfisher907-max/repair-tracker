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
    <div className="mb-4 flex gap-2 sm:hidden">
      {LINKS.map((l) => {
        const active = l.href === '/hangar' ? pathname === '/hangar' : pathname.startsWith(l.href)
        return (
          <Link key={l.href} href={l.href} className={`btn btn-sm flex-1 justify-center ${active ? 'btn-primary' : ''}`}>
            {l.label}
          </Link>
        )
      })}
    </div>
  )
}
