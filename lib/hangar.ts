// Data access for the Hangar section (ported from the retired standalone
// Hangar Tracker). Rows are used in their snake_case DB shape, matching this
// app's convention of thin, direct supabase queries with a manual reload after
// each mutation — no realtime.

import { supabase } from './supabase'

export interface HangarSession {
  id: string
  aircraft: string
  hangar: string
  entry: string
  exit: string | null
  reason: string
  note: string
  exit_reason: string
  exit_note: string
}

export interface HangarUnavail {
  id: string
  start_time: string
  end_time: string | null
  note: string
}

export const OUT = 'Out'

export interface HangarRate {
  id: string
  effective_from: string // 'YYYY-MM-DD'
  monthly_rate_cents: number
  note: string
}

/** A constraint name is not a message. Migration 0069 can refuse a move for two
 *  reasons a person can actually act on; anything else keeps the caller's own
 *  wording. */
export function hangarErrorWords(e: unknown, fallback: string): string {
  const msg =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : ''
  if (msg.includes('hangar_sessions_wings_holds_one')) {
    return 'Wings Hangar already has an aircraft in it, and it only holds one. Move that one out first.'
  }
  if (msg.includes('hangar_sessions_one_place_at_a_time')) {
    return 'That would put the aircraft in two hangars at the same time. Check the times on its other session.'
  }
  return fallback
}

export async function fetchHangarRates(): Promise<HangarRate[]> {
  const { data, error } = await supabase
    .from('hangar_rates')
    .select('*')
    .order('effective_from', { ascending: false })
  if (error) throw error
  return (data ?? []) as HangarRate[]
}

/** One row per change. Re-saving the same effective_from replaces that row
 *  rather than stacking another, so a typo is correctable. */
export async function saveHangarRate(effectiveFrom: string, cents: number): Promise<void> {
  const { error } = await supabase
    .from('hangar_rates')
    .upsert({ effective_from: effectiveFrom, monthly_rate_cents: cents }, { onConflict: 'effective_from' })
  if (error) throw error
}

/** The rate in force during a month, i.e. the newest row effective on or before
 *  that month's first day. Null when no rate covers it - a month before the
 *  first rate was recorded is not worth a guess. */
export function rateForMonth(rates: HangarRate[], monthKey: string): number | null {
  const monthStart = `${monthKey}-01`
  let best: HangarRate | null = null
  for (const r of rates) {
    if (r.effective_from <= monthStart && (!best || r.effective_from > best.effective_from)) best = r
  }
  return best ? best.monthly_rate_cents : null
}

export async function fetchHangarData(): Promise<{
  sessions: HangarSession[]
  unavail: HangarUnavail[]
}> {
  const [s, u] = await Promise.all([
    supabase.from('hangar_sessions').select('*').order('entry', { ascending: false }),
    supabase.from('hangar_unavailability').select('*').order('start_time', { ascending: false }),
  ])
  if (s.error) throw s.error
  if (u.error) throw u.error
  return { sessions: (s.data ?? []) as HangarSession[], unavail: (u.data ?? []) as HangarUnavail[] }
}

// One-tap board action: set a jet's current location. Closes any open session,
// then opens a new one unless the jet is going Out. No-op if already there.
export async function setJetLocation(
  aircraft: string,
  openSession: HangarSession | undefined,
  target: string,
): Promise<void> {
  if (openSession && openSession.hangar === target) return
  const now = new Date().toISOString()
  if (openSession) {
    const upd = await supabase
      .from('hangar_sessions')
      .update({ exit: now, exit_reason: target === OUT ? 'Departed' : 'Aircraft moved', exit_note: '' })
      .eq('id', openSession.id)
    if (upd.error) throw upd.error
  }
  if (target !== OUT) {
    const ins = await supabase.from('hangar_sessions').insert({
      aircraft,
      hangar: target,
      entry: now,
      exit: null,
      reason: openSession ? 'Aircraft moved' : '',
      note: '',
      exit_reason: '',
      exit_note: '',
    })
    if (ins.error) throw ins.error
  }
}

export async function logPastSession(input: {
  aircraft: string
  hangar: string
  entry: string // datetime-local value
  exit: string // datetime-local value or ''
  note: string
}): Promise<void> {
  const { error } = await supabase.from('hangar_sessions').insert({
    aircraft: input.aircraft,
    hangar: input.hangar,
    entry: new Date(input.entry).toISOString(),
    exit: input.exit ? new Date(input.exit).toISOString() : null,
    reason: '',
    note: input.note || '',
    exit_reason: '',
    exit_note: '',
  })
  if (error) throw error
}

export async function confirmExit(
  session: HangarSession,
  exitTime: string,
  reason: string,
  note: string,
): Promise<void> {
  const exit_note = note ? (session.note ? session.note + ' | ' + note : note) : session.note || ''
  const { error } = await supabase
    .from('hangar_sessions')
    .update({
      exit: new Date(exitTime).toISOString(),
      exit_reason: reason || session.reason || '',
      exit_note,
    })
    .eq('id', session.id)
  if (error) throw error
}

export async function updateSession(
  id: string,
  input: { aircraft: string; hangar: string; entry: string; exit: string; reason: string; note: string },
): Promise<void> {
  const { error } = await supabase
    .from('hangar_sessions')
    .update({
      aircraft: input.aircraft,
      hangar: input.hangar,
      entry: new Date(input.entry).toISOString(),
      exit: input.exit ? new Date(input.exit).toISOString() : null,
      reason: input.reason || '',
      exit_reason: input.reason || '',
      note: input.note || '',
      exit_note: input.note || '',
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('hangar_sessions').delete().eq('id', id)
  if (error) throw error
}

export async function logUnavail(input: { start: string; end: string; note: string }): Promise<void> {
  const { error } = await supabase.from('hangar_unavailability').insert({
    start_time: new Date(input.start).toISOString(),
    end_time: input.end ? new Date(input.end).toISOString() : null,
    note: input.note || '',
  })
  if (error) throw error
}

export async function endUnavailNow(id: string): Promise<void> {
  const { error } = await supabase
    .from('hangar_unavailability')
    .update({ end_time: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function updateUnavail(
  id: string,
  input: { start: string; end: string; note: string },
): Promise<void> {
  const { error } = await supabase
    .from('hangar_unavailability')
    .update({
      start_time: new Date(input.start).toISOString(),
      end_time: input.end ? new Date(input.end).toISOString() : null,
      note: input.note || '',
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteUnavail(id: string): Promise<void> {
  const { error } = await supabase.from('hangar_unavailability').delete().eq('id', id)
  if (error) throw error
}
