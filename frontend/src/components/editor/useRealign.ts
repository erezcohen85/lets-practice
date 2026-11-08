import { useEffect, useRef, useState } from 'react'
import { type EditorDoc } from '@/domain/pieceEdits'
import { useClients } from '@/lib/clients'
import { usePlanGate } from '@/lib/plan'
import { SentenceError, sentenceOf } from '@/lib/processorClient'
import { usePiecePlan } from '@/lib/usePiecePlan'
import { jobSignature, STALL_MS } from '@/lib/useStalled'
import { type EditorDocApi, type SaveState } from '@/lib/useEditorDoc'
import { strings } from '@/strings'

const POLL_MS = 1000
/** Reads of the new map before the screen says it is out of date (a blip or a wake from sleep passes in a few seconds). */
const MAP_READ_TRIES = 5

/**
 * Realign as the status line drives it: wait until no save is running (so the processor sees the timing that was
 * saved), start the job, read it at once and then every second until it is done, load the new timing and record it as
 * one step ("realign") with every page layer kept by reference. A save that failed stops it before it starts: the
 * processor would refit a timing older than the screen's. `error` says why the last try did not finish. A plan that has no
 * realigns left for the piece opens the "Not in your plan" prompt instead of starting, and so does the processor's refusal.
 */
export function useRealign(pieceId: string, editor: EditorDocApi, onRealigned: () => void) {
  const { data, processor } = useClients()
  const gate = usePlanGate()
  const piecePlan = usePiecePlan(pieceId)
  const [realigning, setRealigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A calm note while the job runs (it is slow); an error is something that went wrong.
  const [note, setNote] = useState<string | null>(null)

  // The newest editor and callback, for the run that outlives the render that started it.
  const latest = useRef({ editor, onRealigned })
  const alive = useRef(true)
  const waiters = useRef<((state: SaveState) => void)[]>([])
  useEffect(() => {
    latest.current = { editor, onRealigned }
    if (editor.saveState === 'saving') return
    const waiting = waiters.current
    waiters.current = []
    for (const resume of waiting) resume(editor.saveState)
  })
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const saveSettled = () =>
    latest.current.editor.saveState === 'saving'
      ? new Promise<SaveState>((resolve) => waiters.current.push(resolve))
      : Promise.resolve(latest.current.editor.saveState)

  /**
   * The job has finished, so the refit is saved: read it with the patience of the job loop, the lock staying on. If it
   * cannot be read, the screen would go on showing the old times and the next save would replace the refit with them,
   * so it says to reload instead of unlocking quietly.
   */
  async function readNewMap() {
    for (let attempt = 1; attempt <= MAP_READ_TRIES; attempt++) {
      const map = await data.getPieceMap(pieceId).catch(() => null)
      if (map !== null) return map
      if (!alive.current) return null
      if (attempt < MAP_READ_TRIES) await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
    throw new SentenceError(strings.editor.status.realignReload)
  }

  async function run() {
    if ((await saveSettled()) === 'failed') return // "Not saved" is already in the status line
    const started = await gate.run(null, () => processor.realign(pieceId))
    // The plan refused it: the prompt is open, and this is not an error of the realign.
    if (started === undefined) return
    let job = started
    // The wait does not end on a read that failed (offline, asleep, a blip) or on a row not found yet: the job goes on, so
    // the lock stays and the next poll tries again. After STALL_MS without a change the screen says the job is slow, but it
    // keeps waiting: the job may be alive (a long queue, a long listen), and its result would replace what an edit made
    // meanwhile. Reloading the page is the way out of a lost job (the editor then hands over to the Processing screen).
    let signature = jobSignature(job)
    let changedAt = Date.now()
    while (job.status === 'queued' || job.status === 'running') {
      if (!alive.current) return
      const read = await data.getJob(job.id).catch(() => null)
      if (read !== null) {
        job = read
        if (jobSignature(job) !== signature) {
          signature = jobSignature(job)
          changedAt = Date.now()
        }
      }
      if (job.status === 'queued' || job.status === 'running') {
        if (Date.now() - changedAt >= STALL_MS && alive.current) setNote(strings.editor.status.realignSlow)
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
    }
    if (alive.current) setNote(null) // the note about a slow job ends with the job
    if (job.status === 'error') {
      if (alive.current) setError(job.error ?? strings.editor.status.realignFailed)
      return
    }
    const map = await readNewMap()
    if (map === null || !alive.current) return
    const { editor: current, onRealigned: done } = latest.current
    const doc: EditorDoc = { ...current.doc, timing: map.timing }
    current.replace(doc, { kind: 'realign' })
    done()
  }

  return {
    realigning,
    error,
    note,
    start() {
      if (realigning) return
      if (!piecePlan.check({ type: 'realign' })) return
      setRealigning(true)
      setError(null)
      setNote(null)
      run()
        .catch((caught: unknown) => alive.current && setError(sentenceOf(caught) ?? strings.editor.status.realignFailed))
        .finally(() => {
          // The realign counted against the piece, started or refused: read its usage again.
          void piecePlan.reload()
          if (alive.current) setRealigning(false)
        })
    },
  }
}
