'use client'

import { useEffect, useId, useState, type RefObject } from 'react'
import { formatDateShort } from '@/lib/date'
import {
  formatReading,
  loadReadingContext,
  parseReading,
  readingDoubt,
  readingPatch,
  type ReadingContext,
} from '@/lib/reading'
import { READING, type ServiceLine } from '@/lib/service-line'
import type { Job } from '@/lib/types'

/** What a save answered. The message is in plain words; a database error's own text never is. */
export type ReadingSaved = { ok: true } | { ok: false; message: string }

/**
 * The mileage reminder (owner, 2026-11-23: "a reminder when I start a job to
 * record the vehicle mileage before the job gets completed"). Airframe hours
 * on an aircraft; lib/service-line has both sets of words.
 *
 * Two moments, one panel:
 *  - `start`: the job is in progress and has no reading. It sits under the
 *    stage control until one is saved.
 *  - `done`: he is marking the job done and it still has none. The last ask,
 *    with a way past it, because some jobs have no odometer to read.
 *
 * It shows what is already known, so the number can be checked against it: the
 * vehicle's last recorded reading, and a reading already typed on this job's
 * inspection report (one tap to use it, not a second typing).
 */
export default function ReadingPrompt({
  job,
  line,
  mode,
  saveLabel = 'Save',
  skipLabel,
  inputRef,
  onSave,
  onSkip,
  onCancel,
}: {
  job: Pick<Job, 'id' | 'vehicle_id' | 'date'>
  line: ServiceLine
  mode: 'start' | 'done'
  saveLabel?: string
  /** `done` only: the button that goes on without a reading. */
  skipLabel?: string
  inputRef?: RefObject<HTMLInputElement | null>
  /** Saves the reading (and whatever the caller adds to it). */
  onSave: (patch: Partial<Job>, value: number) => Promise<ReadingSaved>
  onSkip?: () => void
  onCancel?: () => void
}) {
  const words = READING[line]
  const titleId = useId()
  const noteId = useId()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** A number that looks wrong, waiting on "save it anyway". */
  const [doubt, setDoubt] = useState<{ value: number; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [context, setContext] = useState<ReadingContext | null>(null)

  useEffect(() => {
    let alive = true
    loadReadingContext({ id: job.id, vehicle_id: job.vehicle_id, date: job.date }, line).then(
      (c) => alive && setContext(c),
      // Nothing known is not an error worth a message: the prompt just says less.
      () => alive && setContext(null),
    )
    return () => {
      alive = false
    }
  }, [job.id, job.vehicle_id, job.date, line])

  async function submit(anyway: boolean) {
    if (busy) return
    const value = parseReading(line, text)
    if (value == null) {
      setDoubt(null)
      setError(words.blank)
      return
    }
    if (Number.isNaN(value)) {
      setDoubt(null)
      setError(words.bad)
      return
    }
    if (!anyway) {
      const why = readingDoubt(line, value, context?.prior ?? null)
      if (why) {
        setError(null)
        setDoubt({ value, text: why })
        return
      }
    }
    setError(null)
    setDoubt(null)
    setBusy(true)
    try {
      const saved = await onSave(readingPatch(line, value), value)
      if (!saved.ok) setError(saved.message)
    } catch {
      setError('It did not save. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const prior = context?.prior ?? null
  const inspection = context?.inspection ?? null

  return (
    <form
      className={`reading-ask panel-in${mode === 'done' ? ' is-last' : ''}`}
      aria-labelledby={titleId}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
    >
      <div id={titleId} className="reading-ask-title">
        {mode === 'done' ? words.missing : words.ask}
      </div>
      <p className="reading-ask-sub">
        {mode === 'done' ? words.lastCall : words.why}
        {prior &&
          ` Last recorded: ${formatReading(line, prior.value)} on ${prior.job_number} (${formatDateShort(prior.date)}).`}
      </p>

      <div className="reading-ask-row">
        <input
          ref={inputRef}
          className="input"
          inputMode={words.inputMode}
          enterKeyHint="done"
          autoComplete="off"
          maxLength={12}
          placeholder={words.placeholder}
          aria-label={words.label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || doubt ? noteId : undefined}
          value={text}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
            setDoubt(null)
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : saveLabel}
        </button>
      </div>

      {/* Typed once already, on the inspection report: offer it, never copy it silently. */}
      {inspection && text.trim() === '' && (
        <button
          type="button"
          className="btn btn-sm reading-ask-use"
          disabled={busy}
          onClick={() => {
            setText(String(inspection.value))
            setError(null)
            setDoubt(null)
            inputRef?.current?.focus()
          }}
        >
          Use {formatReading(line, inspection.value)} from report {inspection.report_number}
        </button>
      )}

      {error && (
        <p id={noteId} role="alert" className="reading-ask-note is-error">
          {error}
        </p>
      )}
      {doubt && (
        <div id={noteId} role="alert" className="reading-ask-note is-doubt">
          <p>{doubt.text} Check the number, or save it as typed.</p>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void submit(true)}>
            Save {formatReading(line, doubt.value)} anyway
          </button>
        </div>
      )}

      {mode === 'done' && (
        <div className="reading-ask-other">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onSkip}>
            {skipLabel}
          </button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </form>
  )
}
