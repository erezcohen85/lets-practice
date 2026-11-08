import { screen } from '@testing-library/react'
import { type JobPart } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const t = strings.split

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })

/** A piece whose job says which of its parts it reads: every read of the piece gives the job these parts. */
async function startedPiece(job: { status: 'running' | 'error'; progress: number; error?: string }, parts: JobPart[] | undefined) {
  const base = createFakes({ signedIn: true, termsAccepted: true })
  const piece = await base.data.createPiece({
    title: 'Band piece',
    recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) },
    parts: [{ file: pdf('band.pdf'), name: 'Band' }],
  })
  await base.processor.processPiece(piece.id)
  const fakes: Fakes = {
    ...base,
    data: {
      ...base.data,
      async getPiece(id) {
        const detail = await base.data.getPiece(id)
        if (detail === null || detail.job === null) return detail
        return { ...detail, job: { ...detail.job, status: job.status, progress: job.progress, error: job.error ?? null, ...(parts === undefined ? {} : { parts }) } }
      },
    },
  }
  return { fakes, pieceId: piece.id }
}

const five = (states: JobPart['state'][]): JobPart[] => ['Flute', 'Oboe', 'Clarinet', 'Horn', 'Tuba'].map((name, index) => ({ id: `p${index}`, name, state: states[index] ?? 'waiting' }))

describe('the Processing page names the part being read', () => {
  it('says "Reading Oboe (2 of 5)" for the part the job is on', async () => {
    const { fakes, pieceId } = await startedPiece({ status: 'running', progress: 0.4 }, five(['done', 'reading']))

    renderWithApp(`/pieces/${pieceId}/processing`, { fakes })

    expect(await screen.findByText(t.readingPart('Oboe', 2, 5))).toBeInTheDocument()
  })

  it('says nothing about a part while all of them wait', async () => {
    const { fakes, pieceId } = await startedPiece({ status: 'running', progress: 0.25 }, five([]))

    renderWithApp(`/pieces/${pieceId}/processing`, { fakes })

    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('looks as it always did for a job without parts', async () => {
    const { fakes, pieceId } = await startedPiece({ status: 'running', progress: 0.4 }, undefined)

    renderWithApp(`/pieces/${pieceId}/processing`, { fakes })

    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('names a part that could not be read, next to the sentence of the job’s error', async () => {
    const { fakes, pieceId } = await startedPiece({ status: 'error', progress: 0.4, error: 'The staves of this page could not be found.' }, five(['done', 'failed']))

    renderWithApp(`/pieces/${pieceId}/processing`, { fakes })

    expect(await screen.findByText(t.couldNotRead('Oboe'))).toBeInTheDocument()
    expect(screen.getByText('The staves of this page could not be found.')).toBeInTheDocument()
  })

  it('says only the name, not a count, for a job that reads one part', async () => {
    const { fakes, pieceId } = await startedPiece({ status: 'running', progress: 0.4 }, [{ id: 'p0', name: 'Flute', state: 'reading' }])

    renderWithApp(`/pieces/${pieceId}/processing`, { fakes })

    expect(await screen.findByText('Reading Flute')).toBeInTheDocument()
  })
})
