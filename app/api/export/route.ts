import { clientForRequest, unauthorized } from '@/lib/server'
import { BACKUP_TABLES, readBackupChunk, type BackupCursor } from '@/lib/backup'

// "Export all data" — Jake's insurance policy against vendor lock-in.
//
// One piece of the backup per call, never the zip: a Vercel function can't
// answer with more than 4.5 MB, and the photos alone are more than that. The
// browser asks for the next piece (?table=…&row=…) until there isn't one,
// fetches each file from its signed link, and zips it all (lib/backup-zip.ts).
// What goes in the CSVs is lib/backup.ts.

export async function GET(request: Request) {
  const auth = await clientForRequest(request)
  if (!auth) return unauthorized()

  const params = new URL(request.url).searchParams
  let from: BackupCursor | null = null
  const table = params.get('table')
  if (table != null) {
    const rowParam = params.get('row') ?? ''
    const row = /^\d{1,15}$/.test(rowParam) ? Number(rowParam) : -1
    if (!BACKUP_TABLES.includes(table) || row < 0) {
      return Response.json({ error: 'That part of the backup doesn’t exist. Start the backup again.' }, { status: 400 })
    }
    from = { table, row }
  }

  try {
    // Private data and signed links: never kept by a browser or a cache.
    return Response.json(await readBackupChunk(auth.supabase, from), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
