/**
 * The shop name used for app chrome, browser tab titles, and PWA metadata.
 *
 * Customer-facing documents prefer `settings.business_name` (editable in
 * Settings) so the paper always matches what Jake configured; this constant
 * covers the places that render before any database read — the static
 * metadata, the manifest, the login screen.
 */
export const BRAND_NAME = 'Wings N Things'

/** Filename-safe form of the name — used for the backup zip ("wings-n-things-export-…"). */
export const BRAND_SLUG = BRAND_NAME.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
