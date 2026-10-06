'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { QUICK_CHECK } from '@/lib/inspection-templates'
import { inspectionErrorWords, startInspection, VERDICT_LABEL, type Inspection } from '@/lib/inspections'

/**
 * The job page's pre-buy card (0067). A pre-buy is billed as the job's labor
 * (the owner sets the hours on the job, so the price stays his to adjust);
 * the report itself lives on /inspections/[id] and is shared by its own link,
 * which the invoice also carries once the report is final.
 */
export default function JobInspection({ jobId, customerName }: { jobId: string; customerName: string | null }) {
  const router = useRouter()
  const [rows, setRows] = useState<Inspection[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
    // Before 0067 the table does not exist: show nothing rather than an error.
    setRows(error ? [] : ((data as Inspection[]) ?? []))
  }, [jobId])

  useEffect(() => {
    let alive = true
    supabase
      .from('inspections')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (alive) setRows(error ? [] : ((data as Inspection[]) ?? []))
      })
    return () => {
      alive = false
    }
  }, [jobId])

  async function start() {
    setBusy(true)
    setMsg(null)
    try {
      const id = await startInspection(jobId, 'quick', customerName)
      router.push(`/inspections/${id}`)
    } catch (e) {
      setMsg(inspectionErrorWords(e, 'start the inspection'))
      setBusy(false)
      await load()
    }
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}/r/${token}`
    try {
      if (navigator.share) await navigator.share({ title: 'Pre-purchase inspection', url })
      else {
        await navigator.clipboard.writeText(url)
        setMsg('Link copied — text it to the customer ✓')
      }
    } catch {
      /* share sheet closed */
    }
  }

  if (rows === null) return null
  const live = rows.filter((r) => r.status !== 'void')

  return (
    <div className="card space-y-2">
      <span className="label !mb-0">Pre-buy inspection</span>
      {live.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="min-w-0">
            <Link href={`/inspections/${r.id}`} style={{ color: 'var(--blue)' }}>
              {r.report_number}
            </Link>{' '}
            <span style={{ color: 'var(--text2)' }}>
              Quick Check · {r.status === 'final' ? (r.verdict ? VERDICT_LABEL[r.verdict] : 'final') : 'in progress'}
            </span>
          </div>
          <div className="flex flex-none items-center gap-2">
            {r.status === 'final' && !r.link_revoked_at && (
              <button className="btn btn-sm" onClick={() => copyLink(r.public_token)}>
                Share report
              </button>
            )}
            <Link className="btn btn-sm" href={`/inspections/${r.id}`}>
              {r.status === 'final' ? 'View' : 'Continue'}
            </Link>
          </div>
        </div>
      ))}
      {live.length === 0 && (
        <>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            A {QUICK_CHECK.name} is about {QUICK_CHECK.hours} hr of checks. The fee is this job&apos;s labor, so
            set the hours under Labor; the report gets its own link and shows on the invoice.
          </p>
          <button className="btn btn-primary" disabled={busy} onClick={start}>
            {busy ? 'Starting…' : 'Start a Quick Check'}
          </button>
        </>
      )}
      {msg && (
        <p className="text-sm" style={{ color: msg.includes('✓') ? 'var(--green)' : 'var(--red)' }} role="status">
          {msg}
        </p>
      )}
    </div>
  )
}
