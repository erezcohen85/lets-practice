import { type Job } from '@/domain/types'

export type StepId = 'recording' | 'pdf' | 'bars' | 'matching' | 'problems'
export type StepState = 'done' | 'active' | 'waiting' | 'failed'
/** fraction is how far through the step the job is, 0..1: 1 for a done step, 0 for a waiting one. */
export interface ProcessingStep { id: StepId; state: StepState; fraction: number }

// The progress range of each step, from the progress the processor writes after its stages (orchestrator.py):
// audio 0.2, pages 0.35, omr 0.55 and play order 0.65, downbeats 0.8 and align 0.95, then done at 1.
type StepRange = { id: StepId; start: number; end: number }
const STEPS: StepRange[] = [
  { id: 'recording', start: 0, end: 0.2 },
  { id: 'pdf', start: 0.2, end: 0.35 },
  { id: 'bars', start: 0.35, end: 0.65 },
  { id: 'matching', start: 0.65, end: 0.95 },
  { id: 'problems', start: 0.95, end: 1 },
]

// A job that adds parts has no recording or matching to do: the pages after 0.3, the bars after 0.8 (pages and omr),
// then the check (the fake's ladder; the processor's add-parts job writes the same).
const ADD_PARTS_STEPS: StepRange[] = [
  { id: 'pdf', start: 0, end: 0.3 },
  { id: 'bars', start: 0.3, end: 0.8 },
  { id: 'problems', start: 0.8, end: 1 },
]

// Progress is a float read from the database, so a step ends a hair before its end value.
const EPSILON = 1e-9

/**
 * Step ends at progress 0.2, 0.35, 0.65, 0.95 and done (1.0); a job that adds parts has three steps, ending at 0.3, 0.8
 * and done. A failed job marks its current step 'failed'.
 */
export function processingSteps(job: Job): ProcessingStep[] {
  const steps = job.kind === 'add-parts' ? ADD_PARTS_STEPS : STEPS
  const progress = job.status === 'done' ? 1 : job.progress
  let current = steps.findIndex((step) => progress + EPSILON < step.end)
  if (current === -1) current = job.status === 'error' ? steps.length - 1 : steps.length

  return steps.map((step, index): ProcessingStep => {
    if (index < current) return { id: step.id, state: 'done', fraction: 1 }
    if (index > current) return { id: step.id, state: 'waiting', fraction: 0 }
    const fraction = Math.min(1, Math.max(0, (progress - step.start) / (step.end - step.start)))
    return { id: step.id, state: job.status === 'error' ? 'failed' : 'active', fraction }
  })
}

/** Which part a job is on: the one being read (with its place among the parts), the one that failed, or null when the job says nothing of its parts. */
export type PartProgress = { kind: 'reading'; name: string; position: number; total: number } | { kind: 'failed'; name: string }

export function partProgress(job: Job): PartProgress | null {
  const parts = job.parts ?? []
  const failed = parts.find((part) => part.state === 'failed')
  if (failed !== undefined) return { kind: 'failed', name: failed.name }
  const reading = parts.findIndex((part) => part.state === 'reading')
  // Between one part done and the next starting nothing reads: the line names the next one instead of going out.
  const lastDone = parts.map((part) => part.state).lastIndexOf('done')
  const index = reading !== -1 ? reading : lastDone !== -1 && parts[lastDone + 1]?.state === 'waiting' ? lastDone + 1 : -1
  return index === -1 ? null : { kind: 'reading', name: parts[index].name, position: index + 1, total: parts.length }
}

/** A part a finished job left out because it could not be read, and the reason. */
export interface SkippedPart { id: string; name: string; error: string }

/**
 * The parts a finished job could not read (it read and kept the others), and the parts an add-parts job that ended in an
 * error could not read (the piece keeps its map, and the bad part can be retried or deleted); none for any other job.
 */
export function skippedParts(job: Job | null): SkippedPart[] {
  if (job === null) return []
  if (job.status !== 'done' && !(job.status === 'error' && job.kind === 'add-parts')) return []
  return (job.parts ?? []).filter((part) => part.state === 'failed').map(({ id, name, error }) => ({ id, name, error: error ?? '' }))
}
