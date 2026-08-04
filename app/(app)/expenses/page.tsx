'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SkeletonList } from '@/components/Skeleton'
import { EXPENSE_CATEGORIES } from '@/lib/payments'
import { centsToInput, formatCents, parseMoney } from '@/lib/money'
import { formatDate } from '@/lib/date'
import type { Expense } from '@/lib/types'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Shop overhead — the other half of a real profit number (QuickBooks' bread and butter). */
export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null)
  const [year, setYear] = useState<'all' | number>(new Date().getFullYear())
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    date: todayIso(), category: 'Other', vendor: '', description: '', amount: '',
  })

  const load = useCallback(async () => {
    const { data } = await supabase.from('expenses').select('*').order('date', { ascending: false })
    setExpenses((data as Expense[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const e of expenses ?? []) set.add(Number(e.date.slice(0, 4)))
    set.add(new Date().getFullYear())
    return [...set].sort((a, b) => b - a)
  }, [expenses])

  const scoped = useMemo(() => {
    if (!expenses) return []
    if (year === 'all') return expenses
    return expenses.filter((e) => Number(e.date.slice(0, 4)) === year)
  }, [expenses, year])

  const total = scoped.reduce((s, e) => s + e.amount_cents, 0)
  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of scoped) map.set(e.category, (map.get(e.category) ?? 0) + e.amount_cents)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [scoped])

  function startEdit(e: Expense) {
    setEditingId(e.id)
    setAdding(true)
    setForm({
      date: e.date,
      category: e.category,
      vendor: e.vendor ?? '',
      description: e.description,
      amount: centsToInput(e.amount_cents),
    })
  }

  async function save() {
    const amount = parseMoney(form.amount)
    if (!form.description.trim() || amount == null) {
      alert('Description and amount are required.')
      return
    }
    setBusy(true)
    const payload = {
      date: form.date,
      category: form.category.trim() || 'Other',
      vendor: form.vendor.trim() || null,
      description: form.description.trim(),
      amount_cents: amount,
    }
    const result = editingId
      ? await supabase.from('expenses').update(payload).eq('id', editingId)
      : await supabase.from('expenses').insert(payload)
    setBusy(false)
    if (result.error) {
      alert(result.error.message)
      return
    }
    setForm({ date: form.date, category: form.category, vendor: form.vendor, description: '', amount: '' })
    setEditingId(null)
    await load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this expense?')) return
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) alert(error.message)
    else await load()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl">Expenses</h1>
        <div className="flex items-center gap-2">
          <select
            className="select !w-auto !min-h-[38px]"
            value={String(year)}
            onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All time</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => { setAdding(!adding); setEditingId(null) }}>
            {adding ? 'Close' : '+ Add expense'}
          </button>
        </div>
      </div>

      {adding && (
        <div className="panel-in card grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className="label">Category</label>
            <input
              className="input"
              list="expense-categories"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
            <datalist id="expense-categories">
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="label">Vendor</label>
            <input className="input" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Description *</label>
            <input
              className="input"
              placeholder="1/2 in impact sockets"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Amount ($) *</label>
            <input className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="col-span-2 sm:col-span-3">
            <button className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : editingId ? 'Save expense' : '+ Add expense'}
            </button>
          </div>
        </div>
      )}

      {byCategory.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between">
            <span className="label !mb-0">
              {year === 'all' ? 'All-time' : year} total
            </span>
            <span className="money text-lg font-bold" style={{ color: 'var(--orange)' }}>
              {formatCents(total)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {byCategory.map(([cat, cents]) => (
              <span key={cat} className="chip" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>
                {cat} {formatCents(cents)}
              </span>
            ))}
          </div>
        </div>
      )}

      {!expenses ? (
        <SkeletonList rows={4} height={56} />
      ) : scoped.length === 0 ? (
        <div className="card text-center" style={{ color: 'var(--text2)' }}>
          No expenses {year === 'all' ? 'yet' : `in ${year}`}. Tools, insurance, shop supplies —
          logging them here is what makes the profit reports real.
        </div>
      ) : (
        <div className="space-y-2">
          {scoped.map((e) => (
            <div key={e.id} className="card flex items-center justify-between gap-2 !py-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{e.description}</div>
                <div className="truncate text-sm" style={{ color: 'var(--text3)' }}>
                  {[formatDate(e.date), e.category, e.vendor].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="money font-semibold">{formatCents(e.amount_cents)}</span>
                <button className="btn btn-sm" onClick={() => startEdit(e)}>✎</button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(e.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
