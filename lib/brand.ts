/**
 * The shop name used for app chrome, browser tab titles, and PWA metadata.
 *
 * Customer-facing documents prefer `settings.business_name` (editable in
 * Settings) so the paper always matches what Jake configured; this constant
 * covers the places that render before any database read — the static
 * metadata, the manifest, the login screen.
 */
export const BRAND_NAME = 'Wings N Things'

/**
 * What the shop does, said under the name wherever the name is a title.
 *
 * "Wings N Things" doesn't tell a stranger what we do, so the letterhead on
 * every quote, invoice and statement, the public site's band, and the app's
 * own sidebar all carry this underneath it (owner, 2026-09-27).
 *
 * Deliberately a constant and not a settings field: it is the brand, not a
 * per-install setting, and threading it through the public document RPCs
 * would mean rewriting each of their bodies to carry one line of text.
 */
export const BRAND_TAGLINE = 'Aviation & Automotive'

/** Filename-safe form of the name — used for the backup zip ("wings-n-things-export-…"). */
export const BRAND_SLUG = BRAND_NAME.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
