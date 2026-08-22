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

/**
 * The localStorage key supabase-js stores the session under, derived exactly
 * the way the library derives it (sb-<project-ref>-auth-token). PRESENCE of
 * this key is the offline-safe "is this the owner's browser?" signal: a
 * network-validated getSession() can return null in a dead zone even though
 * a perfectly good session is stored, which must never strand the PWA.
 */
export const AUTH_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`

/** True when a session is stored locally — readable offline, cleared by signOut. */
export function hasStoredSession(): boolean {
  try {
    return !!window.localStorage.getItem(AUTH_STORAGE_KEY)
  } catch {
    return false
  }
}

/** Access token of the current session, for calling our own API routes. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
