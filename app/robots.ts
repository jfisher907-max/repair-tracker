import type { MetadataRoute } from 'next'

// The customer-facing token pages carry private repair and billing data;
// paths without a token are useless, so listing the prefixes reveals nothing.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: ['/q/', '/i/', '/s/', '/api/'],
    },
  }
}
