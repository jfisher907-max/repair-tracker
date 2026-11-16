'use client'

import { preload } from 'react-dom'
import barlow400Latin from './barlow/barlow-400-latin.woff2'
import barlow500Latin from './barlow/barlow-500-latin.woff2'
import barlow600Latin from './barlow/barlow-600-latin.woff2'
import barlow700Latin from './barlow/barlow-700-latin.woff2'
import barlowCondensed500Latin from './barlow-condensed/barlow-condensed-500-latin.woff2'
import barlowCondensed600Latin from './barlow-condensed/barlow-condensed-600-latin.woff2'
import barlowCondensed700Latin from './barlow-condensed/barlow-condensed-700-latin.woff2'
import interLatin from './inter/inter-latin.woff2'
import spaceGroteskLatin from './space-grotesk/space-grotesk-latin.woff2'
import ibmPlexMono400Latin from './ibm-plex-mono/ibm-plex-mono-400-latin.woff2'
import ibmPlexMono600Latin from './ibm-plex-mono/ibm-plex-mono-600-latin.woff2'

/**
 * The everyday (latin) files, one per face and weight.
 *
 * A browser normally finds out it needs a font file only after it has read the
 * stylesheet and laid out some text. Naming them up front lets it start
 * fetching while the page is still arriving, so text spends less time in the
 * stand-in face. The other alphabets are left to load on demand.
 */
const EVERYDAY = [
  barlow400Latin,
  barlow500Latin,
  barlow600Latin,
  barlow700Latin,
  barlowCondensed500Latin,
  barlowCondensed600Latin,
  barlowCondensed700Latin,
  interLatin,
  spaceGroteskLatin,
  ibmPlexMono400Latin,
  ibmPlexMono600Latin,
]

/**
 * Renders nothing; adds one preload hint per everyday file to the page's head.
 *
 * A client component on purpose. Called from a server component, the hints
 * reach the page too late on any route that is rendered per request (a
 * customer's quote or invoice link, a job): they arrive as data after the head
 * has gone out, instead of as tags in it. Rendered here they are in the head
 * of every page.
 */
export default function PreloadFonts() {
  for (const href of EVERYDAY) {
    // Fonts are always fetched in anonymous mode; without crossOrigin here the
    // hint would fetch a second copy the stylesheet could not reuse.
    preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' })
  }
  return null
}
