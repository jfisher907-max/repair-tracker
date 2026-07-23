'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Client-side auth gate. Real security is RLS on the server — this just keeps
 * the UI behind a login. Sessions persist in localStorage with auto-refresh,
 * so Jake stays signed in on his phone. There is deliberately no signup UI:
 * the single account is provisioned in the Supabase dashboard (see README).
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="text-2xl display" style={{ color: 'var(--text3)' }}>
          🔧 Repair Tracker
        </div>
      </div>
    )
  }

  if (!session) return <LoginForm />
  return <>{children}</>
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={signIn} className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="text-4xl">🔧</div>
          <h1 className="mt-1 text-2xl">Repair Tracker</h1>
          <p className="text-sm" style={{ color: 'var(--text3)' }}>
            Sign in to continue
          </p>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
