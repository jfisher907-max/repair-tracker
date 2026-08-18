'use client'

import { useEffect, useState } from 'react'
import { getAccessToken, supabase } from '@/lib/supabase'
import { BRAND_SLUG } from '@/lib/brand'
import { DEFAULT_TIERS, type MarkupTier } from '@/lib/markup'
import { centsToInput, parseMoney } from '@/lib/money'
import { vehicleLabel, type Customer, type Job, type Vehicle } from '@/lib/types'

interface DeletedItems {
  customers: Customer[]
  vehicles: Vehicle[]
  jobs: Job[]
}

export default function SettingsPage() {
  const [businessName, setBusinessName] = useState('')
  const [bizPhone, setBizPhone] = useState('')
  const [bizAddress, setBizAddress] = useState('')
  const [bizEmail, setBizEmail] = useState('')
  const [laborRate, setLaborRate] = useState('')
  const [taxRate, setTaxRate] = useState('')
  const [termsDays, setTermsDays] = useState('0')
  const [payInstructions, setPayInstructions] = useState('')
  const [stores, setStores] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [markupOn, setMarkupOn] = useState(false)
  const [markupTiers, setMarkupTiers] = useState<MarkupTier[]>(DEFAULT_TIERS)
  const [cardPay, setCardPay] = useState<boolean | null>(null)
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
        setBizPhone(data.business_phone ?? '')
        setBizAddress(data.business_address ?? '')
        setBizEmail(data.business_email ?? '')
        setLaborRate(centsToInput(data.default_labor_rate_cents))
        setTaxRate(String((data.default_tax_rate_bp ?? 0) / 100))
        setTermsDays(String(data.default_invoice_terms_days ?? 0))
        setPayInstructions(data.invoice_payment_instructions ?? '')
        setStores((data.store_suggestions as string[]).join('\n'))
        setMarkupOn(!!data.parts_markup_enabled)
        if (Array.isArray(data.parts_markup_tiers) && data.parts_markup_tiers.length) {
          setMarkupTiers(data.parts_markup_tiers as MarkupTier[])
        }
      })
    getAccessToken().then(async (token) => {
      try {
        const res = await fetch('/api/ai-status', { headers: { Authorization: `Bearer ${token}` } })
        setAiConfigured((await res.json()).configured)
      } catch {
        setAiConfigured(false)
      }
    })
    fetch('/api/pay/status')
      .then((r) => r.json())
      .then((x) => setCardPay(!!x.enabled))
      .catch(() => setCardPay(false))
    loadDeleted()
  }, [])

  async function save() {
    const { error } = await supabase
      .from('settings')
      .update({
        // Blank is allowed — the report header adapts until a name is picked.
        business_name: businessName.trim(),
        business_phone: bizPhone.trim(),
        business_address: bizAddress.trim(),
        business_email: bizEmail.trim(),
        default_labor_rate_cents: parseMoney(laborRate) ?? 0,
        default_tax_rate_bp: Math.round((Number(taxRate) || 0) * 100),
        default_invoice_terms_days: Number(termsDays) || 0,
        invoice_payment_instructions: payInstructions.trim(),
        parts_markup_enabled: markupOn,
        parts_markup_tiers: markupTiers,
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
      a.download = `${BRAND_SLUG}-export-${new Date().toISOString().slice(0, 10)}.zip`
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
          <input
            className="input"
            placeholder="Blank is fine — add it when you've picked one"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Business phone (prints on reports)</label>
            <input className="input" type="tel" inputMode="tel" value={bizPhone} onChange={(e) => setBizPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">Business email (prints on reports)</label>
            <input className="input" type="email" value={bizEmail} onChange={(e) => setBizEmail(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Business address (prints on reports)</label>
            <input className="input" value={bizAddress} onChange={(e) => setBizAddress(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Default labor rate ($/hr)</label>
            <input className="input" inputMode="decimal" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} />
          </div>
          <div>
            <label className="label">Sales tax % (0 = no tax line)</label>
            <input className="input" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </div>
          <div>
            <label className="label">Invoice payment terms</label>
            <select className="select" value={termsDays} onChange={(e) => setTermsDays(e.target.value)}>
              <option value="0">Due on receipt</option>
              <option value="7">Net 7</option>
              <option value="15">Net 15</option>
              <option value="30">Net 30</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Payment instructions (prints on invoices)</label>
          <textarea
            className="textarea !min-h-[60px]"
            placeholder="Cash, check, or Venmo @… — due on receipt"
            value={payInstructions}
            onChange={(e) => setPayInstructions(e.target.value)}
          />
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

      <div className="card space-y-3">
        <div className="label">Parts markup</div>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          A part line with no price typed in is charged <b>at cost</b>. Turn this on and the
          matrix prices those lines for you as they come off a receipt — cheap parts carry a
          higher multiple than expensive ones. You can still override any line by hand, and
          returns and credits are never marked up.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={markupOn}
            onChange={(e) => setMarkupOn(e.target.checked)}
          />
          Price unpriced part lines automatically
        </label>
        <div className="space-y-1">
          {markupTiers.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span style={{ color: 'var(--text3)', minWidth: 92 }}>
                {t.up_to_cents == null ? 'Above that' : `Up to ${(t.up_to_cents / 100).toFixed(2)}`}
              </span>
              <span style={{ color: 'var(--text3)' }}>×</span>
              <input
                className="input !min-h-[38px] !w-24"
                inputMode="decimal"
                aria-label={`Multiplier for tier ${i + 1}`}
                value={t.multiplier}
                onChange={(e) => {
                  const next = [...markupTiers]
                  next[i] = { ...next[i], multiplier: Number(e.target.value) || 0 }
                  setMarkupTiers(next)
                }}
              />
              <span style={{ color: 'var(--text3)' }}>
                a ${((t.up_to_cents ?? 40000) / 100 / 2).toFixed(2)} part →{' '}
                <b className="money" style={{ color: 'var(--text2)' }}>
                  ${((((t.up_to_cents ?? 40000) / 2) * (t.multiplier || 0)) / 100).toFixed(2)}
                </b>
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          These are a starting point, not advice — set them to your own numbers. Existing jobs
          and any invoice already issued are untouched.
        </p>
      </div>

      <div className="card space-y-2">
        <div className="label">Card payments</div>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          {cardPay == null
            ? 'Checking…'
            : cardPay
              ? 'Live — invoices you send show a “Pay by card” button, and paid invoices land in the ledger automatically.'
              : 'Not set up — invoices are paid by cash, check or Venmo and you record them yourself. To accept cards, add the Stripe keys in the Vercel project settings (see README).'}
        </p>
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
