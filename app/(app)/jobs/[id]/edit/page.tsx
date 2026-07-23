'use client'

import { use, useEffect, useState } from 'react'
import JobForm from '@/components/JobForm'
import { supabase } from '@/lib/supabase'
import type { Job } from '@/lib/types'

export default function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('jobs')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setJob(data as Job)
      })
  }, [id])

  if (error) return <p style={{ color: 'var(--red)' }}>{error}</p>
  if (!job) return <p style={{ color: 'var(--text3)' }}>Loading…</p>
  return <JobForm job={job} />
}
