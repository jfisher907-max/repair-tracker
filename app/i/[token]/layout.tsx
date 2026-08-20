import type { ReactNode } from 'react'

// Customer-private page reached only by its unguessable link — search engines
// must never index one that leaks into the open.
export const metadata = {
  robots: { index: false, follow: false },
}

export default function PublicInvoiceLayout({ children }: { children: ReactNode }) {
  return children
}
