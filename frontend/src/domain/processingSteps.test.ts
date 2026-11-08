import { partProgress, processingSteps, skippedParts, type ProcessingStep, type StepId, type StepState } from '@/domain/processingSteps'
import { type Job, type JobPart } from '@/domain/types'

function job(status: Job['status'], progress: number): Job {
  return {
    id: 'job-1',
    pieceId: 'piece-1',
    kind: 'process-piece',
    status,
    progress,
    error: status === 'error' ? 'omr failed: fake failure' : null,
  }
}

function states(steps: ProcessingStep[]): StepState[] {
  return steps.map((step) => step.state)
}

describe('processingSteps', () => {
  it('always lists the five steps in order', () => {
    const ids: StepId[] = ['recording', 'pdf', 'bars', 'matching', 'problems']

    expect(processingSteps(job('queued', 0)).map((step) => step.id)).toEqual(ids)
    expect(processingSteps(job('done', 1)).map((step) => step.id)).toEqual(ids)
  })

  it('starts with the recording step active and the rest waiting', () => {
    const steps = processingSteps(job('queued', 0))

    expect(states(steps)).toEqual(['active', 'waiting', 'waiting', 'waiting', 'waiting'])
    expect(steps[0].fraction).toBe(0)
  })

  it('has the recording step half way at progress 0.1', () => {
    const steps = processingSteps(job('running', 0.1))

    expect(states(steps)).toEqual(['active', 'waiting', 'waiting', 'waiting', 'waiting'])
    expect(steps[0].fraction).toBeCloseTo(0.5)
  })

  it('finishes the recording step at progress 0.2 and starts the PDF step', () => {
    const steps = processingSteps(job('running', 0.2))

    expect(states(steps)).toEqual(['done', 'active', 'waiting', 'waiting', 'waiting'])
    expect(steps[1].fraction).toBe(0)
  })

  it('finishes the PDF step at progress 0.35', () => {
    const steps = processingSteps(job('running', 0.35))

    expect(states(steps)).toEqual(['done', 'done', 'active', 'waiting', 'waiting'])
  })

  it('is two thirds through the bars step at progress 0.55', () => {
    const steps = processingSteps(job('running', 0.55))

    expect(states(steps)).toEqual(['done', 'done', 'active', 'waiting', 'waiting'])
    expect(steps[2].fraction).toBeCloseTo(2 / 3)
  })

  it('moves to matching at 0.65 and keeps it active at 0.8', () => {
    expect(states(processingSteps(job('running', 0.65)))).toEqual(['done', 'done', 'done', 'active', 'waiting'])

    const steps = processingSteps(job('running', 0.8))
    expect(states(steps)).toEqual(['done', 'done', 'done', 'active', 'waiting'])
    expect(steps[3].fraction).toBeCloseTo(0.5)
  })

  it('has the problems step active at progress 0.95', () => {
    const steps = processingSteps(job('running', 0.95))

    expect(states(steps)).toEqual(['done', 'done', 'done', 'done', 'active'])
    expect(steps[4].fraction).toBe(0)
  })

  it('has every step done when the job is done', () => {
    const steps = processingSteps(job('done', 1))

    expect(states(steps)).toEqual(['done', 'done', 'done', 'done', 'done'])
  })

  it('has every step done when the job is done, whatever progress it kept', () => {
    expect(states(processingSteps(job('done', 0.95)))).toEqual(['done', 'done', 'done', 'done', 'done'])
  })

  it('marks the current step failed and the later ones waiting when the job errors', () => {
    const steps = processingSteps(job('error', 0.55))

    expect(states(steps)).toEqual(['done', 'done', 'failed', 'waiting', 'waiting'])
    expect(steps[2].fraction).toBeCloseTo(2 / 3)
  })

  it('fails the recording step when the job errors before any progress', () => {
    expect(states(processingSteps(job('error', 0)))).toEqual(['failed', 'waiting', 'waiting', 'waiting', 'waiting'])
  })

  it('fails the last step when the job errors after the matching', () => {
    expect(states(processingSteps(job('error', 0.95)))).toEqual(['done', 'done', 'done', 'done', 'failed'])
  })

  it('keeps done steps at fraction 1 and waiting steps at fraction 0', () => {
    const steps = processingSteps(job('running', 0.4))

    expect(steps.map((step) => step.fraction)).toEqual([1, 1, expect.closeTo(1 / 6), 0, 0])
  })

  it('keeps the fraction between 0 and 1 for progress outside 0..1', () => {
    expect(processingSteps(job('running', -0.5))[0].fraction).toBe(0)
    expect(states(processingSteps(job('running', 7)))).toEqual(['done', 'done', 'done', 'done', 'done'])
  })
})

describe('processingSteps of a job that adds parts', () => {
  const adding = (status: Job['status'], progress: number): Job => ({ ...job(status, progress), kind: 'add-parts' })

  it('lists the three steps that apply to new parts: the PDFs, the bars, the check', () => {
    const ids: StepId[] = ['pdf', 'bars', 'problems']

    expect(processingSteps(adding('queued', 0)).map((step) => step.id)).toEqual(ids)
    expect(processingSteps(adding('done', 1)).map((step) => step.id)).toEqual(ids)
  })

  it('starts with the PDF step active', () => {
    const steps = processingSteps(adding('queued', 0))

    expect(states(steps)).toEqual(['active', 'waiting', 'waiting'])
    expect(steps[0].fraction).toBe(0)
  })

  it('moves on at the progress the stages write: 0.3 after the pages, 0.8 after the bars', () => {
    expect(states(processingSteps(adding('running', 0.3)))).toEqual(['done', 'active', 'waiting'])
    expect(processingSteps(adding('running', 0.55))[1].fraction).toBeCloseTo(0.5)
    expect(states(processingSteps(adding('running', 0.8)))).toEqual(['done', 'done', 'active'])
  })

  it('has every step done when the job is done', () => {
    expect(states(processingSteps(adding('done', 1)))).toEqual(['done', 'done', 'done'])
  })

  it('marks the current step failed and the later ones waiting when the job errors', () => {
    expect(states(processingSteps(adding('error', 0.5)))).toEqual(['done', 'failed', 'waiting'])
  })
})

describe('partProgress', () => {
  const withParts = (states: JobPart['state'][]): Job => ({
    ...job('running', 0.4),
    parts: states.map((state, index) => ({ id: `p${index}`, name: ['Flute', 'Oboe', 'Horn'][index], state })),
  })

  it('names the part being read, with its place among the parts', () => {
    expect(partProgress(withParts(['done', 'reading', 'waiting']))).toEqual({ kind: 'reading', name: 'Oboe', position: 2, total: 3 })
  })

  it('names the part that failed', () => {
    expect(partProgress(withParts(['done', 'failed', 'waiting']))).toEqual({ kind: 'failed', name: 'Oboe' })
  })

  it('keeps naming the next part in the moment between one part done and the next reading', () => {
    expect(partProgress(withParts(['done', 'waiting', 'waiting']))).toEqual({ kind: 'reading', name: 'Oboe', position: 2, total: 3 })
  })

  it('says nothing while all wait, when all are done, or when the job has no parts field', () => {
    expect(partProgress(withParts(['waiting', 'waiting']))).toBeNull()
    expect(partProgress(withParts(['done', 'done']))).toBeNull()
    expect(partProgress(withParts([]))).toBeNull()
    expect(partProgress(job('running', 0.4))).toBeNull()
  })
})

describe('skippedParts', () => {
  const finished = (parts: JobPart[], status: Job['status'] = 'done'): Job => ({ ...job(status, 1), parts })

  it('lists the parts a finished job could not read, with the reason', () => {
    const parts: JobPart[] = [
      { id: 'p1', name: 'Flute', state: 'done' },
      { id: 'p2', name: 'Drums', state: 'failed', error: 'Page 1 has no five-line staves.' },
    ]
    expect(skippedParts(finished(parts))).toEqual([{ id: 'p2', name: 'Drums', error: 'Page 1 has no five-line staves.' }])
  })

  it('has none for a job that read every part, a job still running, a failed job, or no job', () => {
    expect(skippedParts(finished([{ id: 'p1', name: 'Flute', state: 'done' }]))).toEqual([])
    expect(skippedParts(finished([{ id: 'p1', name: 'Flute', state: 'failed', error: 'x' }], 'running'))).toEqual([])
    expect(skippedParts(finished([{ id: 'p1', name: 'Flute', state: 'failed', error: 'x' }], 'error'))).toEqual([])
    expect(skippedParts(null)).toEqual([])
  })

  it('lists the failed parts of an add-parts job that ended in an error: the piece keeps its map, and the bad part can be dealt with', () => {
    const parts: JobPart[] = [{ id: 'p2', name: 'Drums', state: 'failed', error: 'Page 1 has no five-line staves.' }]
    const ended = { ...finished(parts, 'error'), kind: 'add-parts' as const }
    expect(skippedParts(ended)).toEqual([{ id: 'p2', name: 'Drums', error: 'Page 1 has no five-line staves.' }])
    expect(skippedParts({ ...ended, kind: 'realign' })).toEqual([])
  })

  it('gives a part without a reason an empty one', () => {
    expect(skippedParts(finished([{ id: 'p1', name: 'Flute', state: 'failed' }]))).toEqual([{ id: 'p1', name: 'Flute', error: '' }])
  })
})
