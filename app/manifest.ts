import type { MetadataRoute } from 'next'
import { BRAND_NAME } from '@/lib/brand'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: 'Quotes, invoices, jobs, parts, and receipts for the shop.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0e13',
    theme_color: '#0b0e13',
    icons: [
      { src: '/icon-192', sizes: '192x192', type: 'image/png' },
      { src: '/icon', sizes: '512x512', type: 'image/png' },
    ],
  }
}
