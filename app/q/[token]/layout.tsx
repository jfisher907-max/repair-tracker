import type { ReactNode } from 'react'

// Customer-private page reached only by its unguessable link — search engines
// must never index one that leaks into the open (a forwarded link posted
// somewhere public is enough for a crawler to find it).
export const metadata = {
  robots: { index: false, follow: false },
}

export default function PublicQuoteLayout({ children }: { children: ReactNode }) {
  return children
}
