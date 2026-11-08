import { act, screen, waitFor } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { addJob } from '@/lib/fakes/store'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// Try again on the Processing screen when the processor refuses, and a job that has stopped changing.

const t = strings.processing
const SLOW = 'piece-slow-waltz'
const MARCH = 'piece-concert-march'
const TEN_MINUTES = 10 * 60 * 1000

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('Processing: Try again after a refusal', () => {
  it('shows the processor\'s sentence in place of the generic one', async () => {
    const fakes = createFakes({ seed: 'demo', failStage: 'play order' })
    vi.spyOn(fakes.processor, 'processPiece').mockRejectedValue(new SentenceError(strings.realServices.cannotStart))
    const { user } = renderWithApp(`/pieces/${SLOW}/processing`, { fakes })
    await screen.findByRole('heading', { name: t.failedTitle })

    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    expect(await screen.findByText(strings.realServices.cannotStart)).toBeInTheDocument()
    expect(screen.queryByText(t.retryFailed)).not.toBeInTheDocument()
  })

  it('keeps the generic sentence for any other error', async () => {
    const fakes = createFakes({ seed: 'demo', failStage: 'play order' })
    vi.spyOn(fakes.processor, 'processPiece').mockRejectedValue(new Error('offline'))
    const { user } = renderWithApp(`/pieces/${SLOW}/processing`, { fakes })
    await screen.findByRole('heading', { name: t.failedTitle })

    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    expect(await screen.findByText(t.retryFailed)).toBeInTheDocument()
  })

  it('starts a realign again when the job that failed was a realign', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const failedRealign = addJob(fakes.store, MARCH, 'realign')
    failedRealign.job.status = 'error'
    failedRealign.job.error = 'x'
    const processPiece = vi.spyOn(fakes.processor, 'processPiece')
    const realign = vi.spyOn(fakes.processor, 'realign')
    const { user } = renderWithApp(`/pieces/${MARCH}/processing`, { fakes })
    await screen.findByRole('heading', { name: t.failedTitle })

    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    await waitFor(() => expect(realign).toHaveBeenCalledWith(MARCH))
    expect(processPiece).not.toHaveBeenCalled()
  })
})

describe('Processing: a job that has stopped changing', () => {
  /**
   * A job read as the processor writes it: progress moves at stage ends and between parts, then the next write is far off.
   * `progress()` is what the row says now; `reads` counts how often the screen asked.
   */
  function watching(progress: () => number = () => 0.45) {
    const fakes = createFakes({ seed: 'demo' })
    const frozen = { ...addJob(fakes.store, MARCH, 'process-piece', 2).job }
    const read = fakes.data.getPiece.bind(fakes.data)
    vi.spyOn(fakes.data, 'getPiece').mockImplementation(async (id) => {
      const piece = (await read(id))!
      return { ...piece, job: { ...frozen, status: 'running' as const, progress: progress() } }
    })
    return fakes
  }

  it('keeps the ring, the steps and the polling, and adds a soft note with Try again after ten minutes', async () => {
    const fakes = watching()
    renderWithApp(`/pieces/${MARCH}/processing`, { fakes })
    await screen.findByRole('img', { name: /progress/i })

    await advance(TEN_MINUTES - 5000)
    expect(screen.queryByText(t.stalled)).not.toBeInTheDocument()
    await advance(30_000)

    expect(await screen.findByText(t.stalled)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: t.progressLabel(45) })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.failedTitle })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.common.retry })).toBeEnabled()
    const reads = vi.mocked(fakes.data.getPiece).mock.calls.length
    await advance(5000)
    expect(vi.mocked(fakes.data.getPiece).mock.calls.length).toBeGreaterThan(reads)
  })

  it('says the piece is still being prepared when Try again is refused because the job is alive', async () => {
    const fakes = watching()
    vi.spyOn(fakes.processor, 'processPiece').mockRejectedValue(new SentenceError(strings.realServices.stillPreparing))
    const { user } = renderWithApp(`/pieces/${MARCH}/processing`, { fakes })
    await screen.findByRole('img', { name: /progress/i })
    await advance(TEN_MINUTES + 30_000)
    await screen.findByText(t.stalled)

    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    expect(await screen.findByText(strings.realServices.stillPreparing)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.failedTitle })).not.toBeInTheDocument()
  })

  it('takes the note away when the job moves again', async () => {
    let progress = 0.45
    renderWithApp(`/pieces/${MARCH}/processing`, { fakes: watching(() => progress) })
    await screen.findByRole('img', { name: /progress/i })
    await advance(TEN_MINUTES + 30_000)
    await screen.findByText(t.stalled)

    progress = 0.5
    await advance(3000)

    await waitFor(() => expect(screen.queryByText(t.stalled)).not.toBeInTheDocument())
  })

  it('counts from the last change: a job that writes progress between parts is never stalled', async () => {
    // Four parts of nine minutes: the row changes every nine minutes, so the note never shows in thirty-six.
    let progress = 0.3
    renderWithApp(`/pieces/${MARCH}/processing`, { fakes: watching(() => progress) })
    await screen.findByRole('img', { name: /progress/i })

    for (const next of [0.35, 0.4, 0.45, 0.5]) {
      await advance(9 * 60 * 1000)
      expect(screen.queryByText(t.stalled)).not.toBeInTheDocument()
      progress = next
      await advance(3000)
    }

    expect(screen.getByRole('img', { name: t.progressLabel(50) })).toBeInTheDocument()
  })

  it('does not keep an old refusal under a later error', async () => {
    const fakes = watching()
    vi.spyOn(fakes.processor, 'processPiece').mockRejectedValue(new SentenceError(strings.realServices.stillPreparing))
    const { user } = renderWithApp(`/pieces/${MARCH}/processing`, { fakes })
    await screen.findByRole('img', { name: /progress/i })
    await advance(TEN_MINUTES + 30_000)
    await screen.findByText(t.stalled)
    await user.click(screen.getByRole('button', { name: strings.common.retry }))
    await screen.findByText(strings.realServices.stillPreparing)

    // The same job (a 409 means it is alive) then really fails: same id, now an error.
    const piece = (await fakes.data.getPiece(MARCH))!
    const failedJob = { ...piece.job!, status: 'error' as const, error: 'omr failed: x' }
    vi.mocked(fakes.data.getPiece).mockResolvedValue({ ...piece, job: failedJob })
    await act(() => vi.advanceTimersByTimeAsync(3000))

    expect(await screen.findByRole('heading', { name: t.failedTitle })).toBeInTheDocument()
    expect(screen.queryByText(strings.realServices.stillPreparing)).not.toBeInTheDocument()
  })
})
