import { createClient } from '@supabase/supabase-js'

// Public project values used as fallbacks so the app runs on any host without
// extra env-var setup. The Supabase publishable (anon) key is meant to be exposed
// in client code — every NEXT_PUBLIC_* var ships in the browser bundle regardless —
// and access stays governed by RLS (pinned to the owner's email in is_owner()).
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://kccmalbgfekapedgvhar.supabase.co'
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_90jiDuHcej7FyYxnb-vP-w_DM8LYmzp'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/** Access token of the current session, for calling our own API routes. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
