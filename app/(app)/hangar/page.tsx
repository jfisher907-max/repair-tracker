'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDocumentTitle } from '@/lib/title'
import {
  endUnavailNow,
  fetchHangarData,
  logUnavail,
  setJetLocation,
  type HangarSession,
  type HangarUnavail,
} from '@/lib/hangar'
import { AIRCRAFT } from '@/lib/hangar-stats'
import JetCard from '@/components/hangar/JetCard'
import WingsBlock from '@/components/hangar/WingsBlock'
import PastMoveModal from '@/components/hangar/PastMoveModal'
import PastUnavailModal from '@/components/hangar/PastUnavailModal'
import HangarSubNav from '@/components/hangar/HangarSubNav'

export default function HangarBoardPage() {
  useDocumentTitle('Hangar — Wings N Things')
  const [sessions, setSessions] = useState<HangarSession[] | null>(null)
  const [unavail, setUnavail] = useState<HangarUnavail[] | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [pastMove, setPastMove] = useState(false)
  const [pastUnavail, setPastUnavail] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await fetchHangarData()
      setSessions(d.sessions)
      setUnavail(d.unavail)
    } catch {
      setSessions([])
      setUnavail([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 1s tick drives the live since/elapsed readouts.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(id)
  }, [flash])

  const open = (sessions ?? []).filter((s) => !s.exit)
  const openU = (unavail ?? []).find((u) => !u.end_time)

  async function handleSetLocation(aircraft: string, target: string) {
    const current = open.find((s) => s.aircraft === aircraft)
    if (current && current.hangar === target) return
    setBusy(true)
    try {
      await setJetLocation(aircraft, current, target)
      setFlash(`${aircraft} → ${target}`)
      await load()
    } catch {
      alert('Save failed — check connection.')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleWings(makeUnavailable: boolean) {
    setBusy(true)
    try {
      if (makeUnavailable) {
        if (!openU) await logUnavail({ start: new Date().toISOString(), end: '', note: '' })
        setFlash('Wings Hangar marked unavailable')
      } else {
        if (openU) await endUnavailNow(openU.id)
        setFlash('Wings Hangar back available')
      }
      await load()
    } catch {
      alert('Save failed — check connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <HangarSubNav />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="display text-2xl font-semibold">Hangar</h1>
        {flash && (
          <span className="flash-in text-sm font-semibold" style={{ color: 'var(--green)' }}>
            ✓ {flash}
          </span>
        )}
      </div>

      {sessions === null ? (
        <div className="skeleton h-40 w-full" />
      ) : (
        <>
          <div className="label mb-2">Live positions — tap to log a move</div>
          <div className="grid gap-4 sm:grid-cols-2">
            {AIRCRAFT.map((ac) => (
              <JetCard
                key={ac}
                aircraft={ac}
                openSession={open.find((s) => s.aircraft === ac)}
                now={now}
                busy={busy}
                onSetLocation={(target) => void handleSetLocation(ac, target)}
              />
            ))}
          </div>

          <div className="mt-4">
            <WingsBlock unavail={unavail ?? []} now={now} busy={busy} onToggle={(v) => void handleToggleWings(v)} />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button type="button" className="btn justify-center" onClick={() => setPastMove(true)}>
              ＋ Log past move
            </button>
            <button type="button" className="btn justify-center" onClick={() => setPastUnavail(true)}>
              ＋ Log past unavailability
            </button>
          </div>
        </>
      )}

      {pastMove && (
        <PastMoveModal
          sessions={sessions ?? []}
          onClose={() => setPastMove(false)}
          onSaved={() => {
            setFlash('Past move added to history')
            void load()
          }}
        />
      )}
      {pastUnavail && (
        <PastUnavailModal
          unavail={unavail ?? []}
          onClose={() => setPastUnavail(false)}
          onSaved={() => {
            setFlash('Unavailability added to the log')
            void load()
          }}
        />
      )}
    </div>
  )
}
