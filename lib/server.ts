import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://kccmalbgfekapedgvhar.supabase.co'
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_90jiDuHcej7FyYxnb-vP-w_DM8LYmzp'

/**
 * Builds a Supabase client bound to the caller's bearer token, so every query
 * an API route makes runs under the same RLS as the browser. Returns null when
 * the token is missing or invalid — routes must 401 in that case.
 */
export async function clientForRequest(
  request: Request,
): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return { supabase, user: data.user }
}

export function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 })
}
