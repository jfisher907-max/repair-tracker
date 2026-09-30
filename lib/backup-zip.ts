import JSZip from 'jszip'
import { getAccessToken, supabase } from './supabase'
import { backupReadme, type BackupChunk, type BackupCursor, type BackupFile } from './backup'

// The backup zip, put together in the browser: /api/export hands over the
// CSVs a piece at a time and a signed link per file (lib/backup.ts says why).
// Only Settings loads this, on the click, so the zip library never rides
// along with any other page.

export interface BackupZip {
  blob: Blob
  /** Files that couldn't be downloaded; README.txt names each one. */
  missing: number
}

/** Builds the whole backup, saying what it's doing in plain words as it goes. */
export async function buildBackupZip(progress: (words: string) => void): Promise<BackupZip> {
  progress('Reading your records…')
  const csv = new Map<string, string>()
  const skipped: string[] = []
  const files: BackupFile[] = []
  let generatedAt = ''
  let next: BackupCursor | null = null
  do {
    const chunk: BackupChunk = await fetchChunk(next)
    if (next && chunk.next && chunk.next.table === next.table && chunk.next.row === next.row) {
      throw new Error('Couldn’t make the backup: it stopped moving forward. Try again.')
    }
    generatedAt ||= chunk.generatedAt
    for (const c of chunk.csv) csv.set(c.name, (csv.get(c.name) ?? '') + c.text)
    skipped.push(...chunk.skipped)
    files.push(...chunk.files)
    next = chunk.next
  } while (next)

  const zip = new JSZip()
  for (const [name, text] of csv) zip.file(name, text)

  const filled = new Set<string>()
  const missing: BackupFile[] = []
  for (const [i, f] of files.entries()) {
    progress(`Adding file ${i + 1} of ${files.length}…`)
    const data = await download(f)
    if (!data) {
      missing.push(f)
      continue
    }
    // Photos and PDFs are already compressed; squeezing them again only
    // costs a phone time.
    zip.file(f.zipPath, data, { compression: 'STORE' })
    filled.add(f.folder)
  }

  zip.file('README.txt', backupReadme({ generatedAt, csvNames: new Set(csv.keys()), filled, skipped, missing }))
  progress('Saving the zip…')
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), missing: missing.length }
}

/** One piece from /api/export. Its errors come back already in plain words. */
async function fetchChunk(from: BackupCursor | null): Promise<BackupChunk> {
  // Asked for each piece: a long backup can outlast the sign-in token.
  const token = await getAccessToken()
  const query = from ? `?table=${encodeURIComponent(from.table)}&row=${from.row}` : ''
  let res: Response
  try {
    res = await fetch(`/api/export${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  } catch {
    throw new Error('Couldn’t make the backup: no connection. Check the signal and try again.')
  }
  if (res.status === 401) {
    throw new Error('Couldn’t make the backup: your sign-in has run out. Sign out and back in, then try again.')
  }
  const body = (await res.json().catch(() => null)) as (BackupChunk & { error?: string }) | null
  if (!res.ok || !body || body.error) {
    throw new Error(body?.error ?? `Couldn’t make the backup: the server answered ${res.status}. Try again.`)
  }
  return body
}

/**
 * A file from its signed link — or, if that fails (a link that ran out on a
 * very long backup, a dropped connection), once more through this browser's
 * own sign-in. Null when neither works; the backup goes on without it.
 */
async function download(f: BackupFile): Promise<ArrayBuffer | null> {
  if (f.url) {
    try {
      const res = await fetch(f.url, { cache: 'no-store' })
      if (res.ok) return await res.arrayBuffer()
    } catch {
      // Falls through to the second try.
    }
  }
  try {
    const { data } = await supabase.storage.from('receipts').download(f.storagePath)
    return data ? await data.arrayBuffer() : null
  } catch {
    return null
  }
}
