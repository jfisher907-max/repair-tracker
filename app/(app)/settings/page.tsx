'use client'

import { useEffect, useState } from 'react'
import { getAccessToken, supabase } from '@/lib/supabase'
import { centsToInput, parseMoney } from '@/lib/money'
import { vehicleLabel, type Customer, type Job, type Vehicle } from '@/lib/types'

interface DeletedItems {
  customers: Customer[]
  vehicles: Vehicle[]
  jobs: Job[]
}

export default function SettingsPage() {
  const [businessName, setBusinessName] = useState('')
  const [laborRate, setLaborRate] = useState('')
  const [stores, setStores] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)
  const [aiTest, setAiTest] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleted, setDeleted] = useState<DeletedItems>({ customers: [], vehicles: [], jobs: [] })

  async function loadDeleted() {
    const [c, v, j] = await Promise.all([
      supabase.from('customers').select('*').not('deleted_at', 'is', null),
      supabase.from('vehicles').select('*').not('deleted_at', 'is', null),
      supabase.from('jobs').select('*').not('deleted_at', 'is', null),
    ])
    setDeleted({
      customers: (c.data as Customer[]) ?? [],
      vehicles: (v.data as Vehicle[]) ?? [],
      jobs: (j.data as Job[]) ?? [],
    })
  }

  useEffect(() => {
    supabase
      .from('settings')
      .select('*')
      .single()
      .then(({ data }) => {
        if (!data) return
        setBusinessName(data.business_name)
        setLaborRate(centsToInput(data.default_labor_rate_cents))
        setStores((data.store_suggestions as string[]).join('\n'))
      })
    getAccessToken().then(async (token) => {
      try {
        const res = await fetch('/api/ai-status', { headers: { Authorization: `Bearer ${token}` } })
        setAiConfigured((await res.json()).configured)
      } catch {
        setAiConfigured(false)
      }
    })
    loadDeleted()
  }, [])

  async function save() {
    const { error } = await supabase
      .from('settings')
      .update({
        business_name: businessName.trim() || 'My Repair Shop',
        default_labor_rate_cents: parseMoney(laborRate) ?? 0,
        store_suggestions: stores
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      })
      .eq('id', 1)
    setSavedMsg(error ? error.message : 'Saved ✓')
    setTimeout(() => setSavedMsg(''), 2500)
  }

  async function testExtraction() {
    setTesting(true)
    setAiTest(null)
    const token = await getAccessToken()
    try {
      const res = await fetch('/api/ai-status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json()
      setAiTest(body.ok ? `Working ✓ (${body.model})` : `Failed: ${body.error}`)
    } catch (e) {
      setAiTest(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    setTesting(false)
  }

  async function exportAll() {
    setExporting(true)
    try {
      const token = await getAccessToken()
      const res = await fetch('/api/export', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `repair-tracker-export-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
    setExporting(false)
  }

  async function restore(table: 'customers' | 'vehicles' | 'jobs', id: string) {
    const { error } = await supabase.from(table).update({ deleted_at: null }).eq('id', id)
    if (error) alert(error.message)
    else loadDeleted()
  }

  const deletedCount = deleted.customers.length + deleted.vehicles.length + deleted.jobs.length

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl">Settings</h1>

      <div className="card space-y-3">
        <div>
          <label className="label">Business name (shows on customer reports)</label>
          <input className="input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
        </div>
        <div>
          <label className="label">Default labor rate ($/hr)</label>
          <input className="input" inputMode="decimal" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} />
        </div>
        <div>
          <label className="label">Store suggestions (one per line)</label>
          <textarea className="textarea" value={stores} onChange={(e) => setStores(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={save}>Save settings</button>
          {savedMsg && <span style={{ color: 'var(--green)' }}>{savedMsg}</span>}
        </div>
      </div>

      <div className="card space-y-2">
        <div className="label">Receipt AI</div>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          {aiConfigured == null
            ? 'Checking…'
            : aiConfigured
              ? 'An Anthropic API key is configured on the server — receipt photos are read automatically.'
              : 'No API key configured — receipts work fine, you just type the lines in yourself. To enable AI reading, set ANTHROPIC_API_KEY in the Vercel project settings (see README).'}
        </p>
        {aiConfigured && (
          <div className="flex items-center gap-3">
            <button className="btn btn-sm" onClick={testExtraction} disabled={testing}>
              {testing ? 'Testing…' : 'Test extraction'}
            </button>
            {aiTest && (
              <span className="text-sm" style={{ color: aiTest.startsWith('Working') ? 'var(--green)' : 'var(--red)' }}>
                {aiTest}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="card space-y-2">
        <div className="label">Backup</div>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Downloads a zip with every table as CSV plus all receipt photos. Your data is yours —
          keep a copy somewhere safe now and then.
        </p>
        <button className="btn" onClick={exportAll} disabled={exporting}>
          {exporting ? 'Building zip…' : '⬇️ Export all data'}
        </button>
      </div>

      <div className="card space-y-2">
        <div className="label">Recently deleted{deletedCount ? ` (${deletedCount})` : ''}</div>
        {deletedCount === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text3)' }}>Nothing in the trash.</p>
        ) : (
          <div className="space-y-1 text-sm">
            {deleted.jobs.map((j) => (
              <RestoreRow key={j.id} label={`Job ${j.job_number} — ${j.title}`} onRestore={() => restore('jobs', j.id)} />
            ))}
            {deleted.vehicles.map((v) => (
              <RestoreRow key={v.id} label={`Vehicle — ${vehicleLabel(v)}`} onRestore={() => restore('vehicles', v.id)} />
            ))}
            {deleted.customers.map((c) => (
              <RestoreRow key={c.id} label={`Customer — ${c.name}`} onRestore={() => restore('customers', c.id)} />
            ))}
          </div>
        )}
      </div>

      <div className="pb-4 text-right">
        <button className="btn btn-sm" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}

function RestoreRow({ label, onRestore }: { label: string; onRestore: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1" style={{ background: 'var(--bg2)' }}>
      <span className="truncate" style={{ color: 'var(--text2)' }}>{label}</span>
      <button className="btn btn-sm" onClick={onRestore}>Restore</button>
    </div>
  )
}
