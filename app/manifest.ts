import type { MetadataRoute } from 'next'
import { BRAND_NAME } from '@/lib/brand'

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Pinned install identity. Without it the id derives from start_url, so
    // changing start_url would make Android treat the installed app as a
    // brand-new one (duplicate install, orphaned icon). Never change this.
    id: '/',
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: 'Quotes, invoices, jobs, parts, and receipts for the shop.',
    // The app's front door. '/' is the public landing page; already-installed
    // PWAs that still start at '/' get forwarded by RedirectIfOwner.
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0b0e13',
    theme_color: '#0b0e13',
    icons: [
      { src: '/icon-192', sizes: '192x192', type: 'image/png' },
      { src: '/icon', sizes: '512x512', type: 'image/png' },
    ],
  }
}
