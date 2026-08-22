import type { MetadataRoute } from 'next'

// '/' is the public landing page and the only thing worth indexing. The
// customer token pages carry private repair and billing data, and the owner
// app routes are just a login box to a crawler — none of it belongs in
// search results. Listing the prefixes reveals nothing (paths without a
// token or a session are useless).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: [
        '/q/', '/i/', '/s/', '/api/',
        '/dashboard', '/jobs', '/customers', '/vehicles', '/billing',
        '/quotes', '/invoices', '/requests', '/followups', '/reports',
        '/expenses', '/settings', '/report', '/reset',
      ],
    },
  }
}
