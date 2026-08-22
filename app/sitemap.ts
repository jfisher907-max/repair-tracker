import type { MetadataRoute } from 'next'

// One public page. Everything else is either the owner's app (robots-blocked)
// or token links that must never be indexed.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://wingsnthings.repair/',
      changeFrequency: 'monthly',
      priority: 1,
    },
  ]
}
