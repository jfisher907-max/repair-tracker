/**
 * Database errors in plain words. No imports on purpose: server routes (the
 * backup) and every feature's own lib file can use these without pulling in
 * the finance loaders. lib/sales-tax.ts re-exports both, so the pages that
 * already import them from there are unchanged.
 */

/**
 * The database said the table or column is not there: that feature's
 * migration is not applied yet. Decided on the error CODE, never the message —
 * an RLS refusal or a check failure also names the table, and is a different
 * problem.
 */
export function isMissingSchema(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  return code === 'PGRST205' || code === 'PGRST204' || code === '42P01' || code === '42703'
}

/**
 * A database refusal in plain words (never a constraint name or a code).
 * `schema` names the database update a missing table or column belongs to,
 * e.g. 'taxes (migration 0053)'; the default keeps the Taxes page's wording.
 */
export function dbErrorWords(e: unknown, what: string, schema = 'taxes (migration 0053)'): string {
  const code = (e as { code?: string } | null)?.code
  const message = (e as { message?: string } | null)?.message ?? String(e)
  if (isMissingSchema(e)) return `Couldn’t ${what}: the database update for ${schema} isn’t applied yet.`
  if (code === '42501' || /row-level security/i.test(message))
    return `Couldn’t ${what}: the database refused it for this sign-in. Sign out and back in, then try again.`
  if (code === '23514') return `Couldn’t ${what}: one of the entries isn’t allowed. Check the dates and the amount.`
  if (/failed to fetch|network/i.test(message)) return `Couldn’t ${what}: no connection. Check the signal and try again.`
  return `Couldn’t ${what}. Try again; if it keeps failing, note this: ${message}`
}
