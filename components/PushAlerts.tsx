'use client'

import { useEffect, useState } from 'react'
import { getAccessToken, supabase } from '@/lib/supabase'

/**
 * Settings card: turn on lock-screen alerts for new service requests on THIS
 * device (migration 0068). Each phone/computer opts in separately; the
 * subscription row is written straight to push_subscriptions under RLS.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'not-configured' }
  | { kind: 'needs-install' } // iPhone/iPad Safari tab: push only works from the Home Screen app
  | { kind: 'unsupported' }
  | { kind: 'blocked' } // permission denied in browser/OS settings
  | { kind: 'off'; publicKey: string }
  | { kind: 'on'; publicKey: string }

function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function authedFetch(path: string, init?: RequestInit) {
  const token = await getAccessToken()
  return fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } })
}

async function detectState(): Promise<State> {
  let publicKey: string
  try {
    const res = await authedFetch('/api/push/config')
    const x = await res.json()
    if (!x.configured || !x.publicKey) return { kind: 'not-configured' }
    publicKey = x.publicKey as string
  } catch {
    return { kind: 'not-configured' }
  }
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) return { kind: isIOS() && !isStandalone() ? 'needs-install' : 'unsupported' }
  if (Notification.permission === 'denied') return { kind: 'blocked' }
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? { kind: 'on', publicKey } : { kind: 'off', publicKey }
}

export default function PushAlerts() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let live = true
    detectState().then((s) => {
      if (live) setState(s)
    })
    return () => {
      live = false
    }
  }, [])

  async function turnOn(publicKey: string) {
    setBusy(true)
    setMsg(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? { kind: 'blocked' } : { kind: 'off', publicKey })
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(publicKey),
      })
      const json = sub.toJSON()
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? '',
          auth: json.keys?.auth ?? '',
          user_agent: navigator.userAgent.slice(0, 400),
        },
        { onConflict: 'endpoint' },
      )
      if (error) {
        await sub.unsubscribe()
        throw new Error(error.message)
      }
      setState({ kind: 'on', publicKey })
      setMsg({ ok: true, text: 'Alerts are on for this device.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function turnOff(publicKey: string) {
    setBusy(true)
    setMsg(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setState({ kind: 'off', publicKey })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await authedFetch('/api/push/test', { method: 'POST' })
      const x = await res.json()
      setMsg(
        x.ok
          ? { ok: true, text: `Sent to ${x.sent} device${x.sent === 1 ? '' : 's'} — it should pop up in a few seconds.` }
          : { ok: false, text: x.error ?? 'No device accepted the test. Try turning alerts off and on again.' },
      )
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const note = (text: string) => (
    <p className="text-sm" style={{ color: 'var(--text2)' }}>
      {text}
    </p>
  )

  return (
    <div className="card space-y-2">
      <div className="label">New request alerts</div>
      {state.kind === 'loading' && note('Checking…')}
      {state.kind === 'not-configured' &&
        note(
          'Push is not set up on the server yet. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the Vercel project settings (see README), then come back here.',
        )}
      {state.kind === 'needs-install' &&
        note(
          'On iPhone, alerts only work from the installed app. In Safari tap Share → Add to Home Screen, open the app from your Home Screen, and turn alerts on here.',
        )}
      {state.kind === 'unsupported' && note("This browser can't receive push alerts. Try the installed app on your phone.")}
      {state.kind === 'blocked' &&
        note(
          'Notifications are blocked for this app. Allow them in your phone or browser settings (Settings → Notifications), then reload this page.',
        )}
      {(state.kind === 'off' || state.kind === 'on') && (
        <>
          {note(
            state.kind === 'on'
              ? 'On for this device. Your phone will buzz the moment a customer sends a service request.'
              : 'Get a lock-screen alert on this device the moment a customer sends a service request.',
          )}
          <div className="flex flex-wrap items-center gap-3">
            {state.kind === 'off' ? (
              <button className="btn btn-primary" onClick={() => turnOn(state.publicKey)} disabled={busy}>
                {busy ? 'Turning on…' : 'Turn on alerts'}
              </button>
            ) : (
              <>
                <button className="btn btn-sm" onClick={sendTest} disabled={busy}>
                  {busy ? 'Sending…' : 'Send a test'}
                </button>
                <button className="btn btn-sm" onClick={() => turnOff(state.publicKey)} disabled={busy}>
                  Turn off on this device
                </button>
              </>
            )}
          </div>
        </>
      )}
      {msg && (
        <p className="text-sm" style={{ color: msg.ok ? 'var(--green)' : 'var(--red)' }}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
