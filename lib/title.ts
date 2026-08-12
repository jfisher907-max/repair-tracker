import { useEffect } from 'react'
import { BRAND_NAME } from '@/lib/brand'

/**
 * Names the browser tab after the document on screen — which is also what
 * the browser suggests as the print-to-PDF filename, so a saved invoice
 * lands as "INV-001 Invoice — Sam Steensland.pdf" instead of the app name.
 * Restores the shop name on unmount.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return
    document.title = title
    return () => {
      document.title = BRAND_NAME
    }
  }, [title])
}
