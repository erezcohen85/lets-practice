import { act, screen, waitFor, within } from '@testing-library/react'
import { type StepId, type StepState } from '@/domain/processingSteps'
import { createFakes, type CreateFakesOptions, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const t = strings.processing
const SIGNED_IN = { signedIn: true, termsAccepted: true } as const
const STEP_IDS: StepId[] = ['recording', 'pdf', 'bars', 'matching', 'problems']

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })

/**
 * A piece with two parts and a job that is started but has not been read yet: each read of the piece moves the job
 * one stage on (audio 20%, pages 35%, omr 55%, play order 65%, downbeats 80%, align 95%, then done).
 */
async function startedPiece(options: CreateFakesOptions = {}) {
  const fakes = createFakes({ ...SIGNED_IN, ...options })
  const piece = await fakes.data.createPiece({
    title: 'Spring Waltz',
    recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) },
    parts: [
      { file: pdf('violin.pdf'), name: 'Violin' },
      { file: pdf('cello.pdf'), name: 'Cello' },
    ],
  })
  await fakes.processor.processPiece(piece.id)
  return { fakes, pieceId: piece.id }
}

const processingPath = (pieceId: string) => `/pieces/${pieceId}/processing`
const pathNow = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname

// With fake timers started as vi.useFakeTimers({ shouldAdvanceTime: true }), one poll is one second.
const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(1000))

const ring = (percent: number) => screen.findByRole('img', { name: t.progressLabel(percent) })
const stepList = () => screen.getByRole('list', { name: t.stepsLabel })
const stepRows = () => within(stepList()).getAllByRole('listitem')

function expectSteps(states: StepState[]) {
  const rows = stepRows()
  expect(rows).toHaveLength(5)
  states.forEach((state, index) => {
    expect(rows[index]).toHaveTextContent(t.steps[STEP_IDS[index]])
    expect(rows[index]).toHaveAttribute('data-state', state)
  })
}

/** The fakes with the piece's job replaced on every read, to show the page a job at a chosen point. */
function withJob(fakes: Fakes, job: { status: 'queued' | 'running' | 'error'; progress: number; error?: string }): Fakes {
  return {
    ...fakes,
    data: {
      ...fakes.data,
      async getPiece(id) {
        const detail = await fakes.data.getPiece(id)
        if (detail === null || detail.job === null) return detail
        return { ...detail, job: { ...detail.job, status: job.status, progress: job.progress, error: job.error ?? null } }
      },
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the Processing page', () => {
  it('moves the steps on as the job does and lands on the piece hub when it is done', async () => {
    const { fakes, pieceId } = await startedPiece()
    const { router } = renderWithApp(processingPath(pieceId), { fakes })

    // The first read: the recording is read, the PDFs are next.
    await ring(20)
    expect(screen.getByRole('heading', { level: 1, name: t.title('Spring Waltz') })).toBeInTheDocument()
    expectSteps(['done', 'active', 'waiting', 'waiting', 'waiting'])

    await nextPoll()
    await ring(35)
    expectSteps(['done', 'done', 'active', 'waiting', 'waiting'])

    await nextPoll()
    await ring(55)
    expectSteps(['done', 'done', 'active', 'waiting', 'waiting'])

    await nextPoll()
    await ring(65)
    expectSteps(['done', 'done', 'done', 'active', 'waiting'])

    await nextPoll()
    await ring(80)
    expectSteps(['done', 'done', 'done', 'active', 'waiting'])

    await nextPoll()
    await ring(95)
    expectSteps(['done', 'done', 'done', 'done', 'active'])
    expect(pathNow(router)).toBe(processingPath(pieceId))

    await nextPoll()
    await waitFor(() => expect(pathNow(router)).toBe(`/pieces/${pieceId}`))
  })

  it('names the five steps as Erez worded them', () => {
    expect(t.steps).toEqual({
      recording: 'Uploading your music',
      pdf: 'Reading your sheet music',
      bars: 'Locating bars and musical marks',
      matching: 'Aligning the bars to the recording',
      problems: 'Reviewing for problems',
    })
  })

  it('says the matching step is the longest, under that step and only while it runs', async () => {
    const { fakes, pieceId } = await startedPiece()
    renderWithApp(processingPath(pieceId), { fakes })
    const note = () => screen.queryByText('This is the longest step. It can take a few minutes.')

    await ring(20)
    expect(note()).not.toBeInTheDocument()
    await nextPoll()
    await nextPoll()
    await nextPoll()
    await ring(65)
    expectSteps(['done', 'done', 'done', 'active', 'waiting'])
    expect(note()).toBeInTheDocument()
    expect(stepRows()[3]).toContainElement(note())
    await nextPoll()
    await ring(80)
    expect(note()).toBeInTheDocument()

    await nextPoll()
    await ring(95)
    expectSteps(['done', 'done', 'done', 'done', 'active'])
    expect(note()).not.toBeInTheDocument()
  })

  it('replaces the processing page in the history, so Back does not return to it', async () => {
    const { fakes, pieceId } = await startedPiece()
    const { router } = renderWithApp(processingPath(pieceId), { fakes })
    await ring(20)

    for (let poll = 0; poll < 6; poll++) await nextPoll()
    await waitFor(() => expect(pathNow(router)).toBe(`/pieces/${pieceId}`))

    await act(() => router.navigate(-1))
    expect(pathNow(router)).not.toBe(processingPath(pieceId))
  })

  it('shows the job progress in the ring and the share of the active step in its bar', async () => {
    const { fakes, pieceId } = await startedPiece()
    renderWithApp(processingPath(pieceId), { fakes: withJob(fakes, { status: 'running', progress: 0.62 }) })

    // Progress 62%: the ring says 62%; the bars step spans 35% to 65%, so it is 90% through.
    const image = await ring(62)
    expect(within(image).getByText('62%')).toBeInTheDocument()
    expectSteps(['done', 'done', 'active', 'waiting', 'waiting'])

    const bar = within(stepRows()[2]).getByRole('progressbar', { name: t.steps.bars })
    expect(bar).toHaveAttribute('aria-valuenow', '90')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    // Only the active step has a bar.
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
  })

  it('shows 0% for a job that is still queued, with the recording step active', async () => {
    const { fakes, pieceId } = await startedPiece()
    renderWithApp(processingPath(pieceId), { fakes: withJob(fakes, { status: 'queued', progress: 0 }) })

    await ring(0)
    expectSteps(['active', 'waiting', 'waiting', 'waiting', 'waiting'])
    expect(within(stepRows()[0]).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('names each step by its state in words as well as by colour', async () => {
    const { fakes, pieceId } = await startedPiece()
    renderWithApp(processingPath(pieceId), { fakes: withJob(fakes, { status: 'running', progress: 0.5 }) })
    await ring(50)

    const rows = stepRows()
    expect(within(rows[0]).getByText(t.stepStates.done)).toBeInTheDocument()
    expect(within(rows[2]).getByText(t.stepStates.active)).toBeInTheDocument()
    expect(rows[2]).toHaveAttribute('aria-current', 'step')
    expect(within(rows[3]).getByText(t.stepStates.waiting)).toBeInTheDocument()
    expect(within(rows[4]).getByText(t.stepStates.waiting)).toBeInTheDocument()
    expect(rows.filter((row) => row.hasAttribute('aria-current'))).toHaveLength(1)
  })

  it('tells what the finished steps found: the recording length and the parts and pages', async () => {
    const { fakes, pieceId } = await startedPiece()
    renderWithApp(processingPath(pieceId), { fakes })
    await ring(20)
    await nextPoll()
    await ring(35)

    // The fake finds a 4:31 recording (the synthetic piece) and 4 pages in each of the 2 parts.
    expect(within(stepRows()[0]).getByText('4:31')).toBeInTheDocument()
    expect(within(stepRows()[1]).getByText(t.partsAndPages(2, 8))).toBeInTheDocument()
  })

  it('has the way back, the note that the piece keeps processing, and neither Cancel nor a time estimate', async () => {
    const { fakes, pieceId } = await startedPiece()
    renderWithApp(processingPath(pieceId), { fakes })
    await ring(20)

    expect(screen.getByText(t.leaveNote)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: strings.common.backToLibrary })).toHaveAttribute('href', '/library')
    const toLibrary = screen.getByRole('link', { name: t.backToLibrary })
    expect(toLibrary).toHaveAttribute('href', '/library')
    expect(toLibrary).toHaveClass('h-14')
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/minute|second|left|remaining/i)).not.toBeInTheDocument()
  })

  it('stops reading the piece once it has gone to the hub', async () => {
    const { fakes, pieceId } = await startedPiece()
    const getPiece = vi.spyOn(fakes.data, 'getPiece')
    const { router } = renderWithApp(processingPath(pieceId), { fakes })
    await ring(20)

    for (let poll = 0; poll < 6; poll++) await nextPoll()
    await waitFor(() => expect(pathNow(router)).toBe(`/pieces/${pieceId}`))
    const reads = getPiece.mock.calls.length
    await nextPoll()
    await nextPoll()

    expect(getPiece.mock.calls.length).toBe(reads)
  })

  describe('when processing fails', () => {
    async function failedAtBars() {
      const { fakes, pieceId } = await startedPiece({ failStage: 'omr' })
      const view = renderWithApp(processingPath(pieceId), { fakes })
      await ring(20)
      await nextPoll()
      await ring(35)
      await nextPoll()
      await screen.findByRole('heading', { name: t.failedTitle })
      return { pieceId, ...view }
    }

    it('marks the bars step as failed and shows the error text, with Try again and Back to library', async () => {
      await failedAtBars()

      expect(screen.getByRole('alert')).toHaveTextContent('omr failed: fake failure')
      expectSteps(['done', 'done', 'failed', 'waiting', 'waiting'])
      expect(within(stepRows()[2]).getByText(t.stepStates.failed)).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1, name: t.title('Spring Waltz') })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: strings.common.retry })).toBeEnabled()
      expect(screen.getByRole('link', { name: t.backToLibrary })).toHaveAttribute('href', '/library')
      // It has stopped: no ring, no "keeps processing" note, no bar.
      expect(screen.queryByRole('img', { name: /progress/i })).not.toBeInTheDocument()
      expect(screen.queryByText(t.leaveNote)).not.toBeInTheDocument()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('stops polling at the failure', async () => {
      const { fakes } = await failedAtBars()
      const getPiece = vi.spyOn(fakes.data, 'getPiece')

      await nextPoll()
      await nextPoll()

      expect(getPiece).not.toHaveBeenCalled()
    })

    it('has Try again start a new job, run it from the start and land on the hub', async () => {
      const { fakes, pieceId, user, router } = await failedAtBars()
      const processPiece = vi.spyOn(fakes.processor, 'processPiece')
      const jobsBefore = fakes.store.jobs.size

      await user.click(screen.getByRole('button', { name: strings.common.retry }))

      expect(processPiece).toHaveBeenCalledTimes(1)
      expect(processPiece).toHaveBeenCalledWith(pieceId)
      expect(fakes.store.jobs.size).toBe(jobsBefore + 1)
      // The error is gone and the new job shows from its first stage.
      await ring(20)
      expect(screen.queryByRole('heading', { name: t.failedTitle })).not.toBeInTheDocument()
      expectSteps(['done', 'active', 'waiting', 'waiting', 'waiting'])

      for (let poll = 0; poll < 6; poll++) await nextPoll()
      await waitFor(() => expect(pathNow(router)).toBe(`/pieces/${pieceId}`))
    })

    it('says so when a new job could not be started, and lets the user try again', async () => {
      const { fakes, user } = await failedAtBars()
      const processPiece = vi.spyOn(fakes.processor, 'processPiece').mockRejectedValueOnce(new Error('offline'))

      await user.click(screen.getByRole('button', { name: strings.common.retry }))

      expect(await screen.findByText(t.retryFailed)).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: t.failedTitle })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: strings.common.retry })).toBeEnabled()

      await user.click(screen.getByRole('button', { name: strings.common.retry }))
      expect(processPiece).toHaveBeenCalledTimes(2)
      await ring(20)
      expect(screen.queryByText(t.retryFailed)).not.toBeInTheDocument()
    })

    it('does not start a second job when Try again is clicked twice in a row', async () => {
      const { fakes, user } = await failedAtBars()
      const processPiece = vi.spyOn(fakes.processor, 'processPiece')
      const button = screen.getByRole('button', { name: strings.common.retry })

      await user.dblClick(button)
      await ring(20)

      expect(processPiece).toHaveBeenCalledTimes(1)
    })

    it('shows a plain sentence when the job gives no error text', async () => {
      const { fakes, pieceId } = await startedPiece()
      renderWithApp(processingPath(pieceId), { fakes: withJob(fakes, { status: 'error', progress: 0.35 }) })

      expect(await screen.findByRole('heading', { name: t.failedTitle })).toBeInTheDocument()
      expect(screen.getByText(t.failedFallback)).toBeInTheDocument()
    })
  })

  describe('when there is nothing to wait for', () => {
    it('goes straight to the hub for a piece whose job is done', async () => {
      const { router } = renderWithApp('/pieces/piece-clark-county/processing', { seed: 'demo' })

      await waitFor(() => expect(pathNow(router)).toBe('/pieces/piece-clark-county'))
    })

    it('goes to the hub for a piece that has no job', async () => {
      const fakes = createFakes(SIGNED_IN)
      const piece = await fakes.data.createPiece({
        title: 'Not started',
        recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) },
        parts: [{ file: pdf('violin.pdf'), name: 'Violin' }],
      })
      const { router } = renderWithApp(processingPath(piece.id), { fakes })

      await waitFor(() => expect(pathNow(router)).toBe(`/pieces/${piece.id}`))
    })

    it('shows the not-found page for a piece that does not exist', async () => {
      renderWithApp('/pieces/no-such-piece/processing', SIGNED_IN)

      expect(await screen.findByRole('heading', { name: strings.common.notFoundTitle })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: strings.common.goToLibrary })).toHaveAttribute('href', '/library')
    })
  })

  describe('while loading and when the piece cannot be read', () => {
    it('shows a loading card with the way back until the piece has been read', async () => {
      const { fakes, pieceId } = await startedPiece()
      let release: () => void = () => {}
      const held = new Promise<void>((done) => (release = done))
      const slow: Fakes = {
        ...fakes,
        data: {
          ...fakes.data,
          async getPiece(id) {
            await held
            return fakes.data.getPiece(id)
          },
        },
      }
      renderWithApp(processingPath(pieceId), { fakes: slow })

      // (The loading card of the session check comes first, with the same name; this one has the page's own message.)
      expect(await screen.findByText(t.loading)).toBeInTheDocument()
      expect(screen.getByRole('status', { name: strings.common.loading })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: strings.common.backToLibrary })).toHaveAttribute('href', '/library')

      await act(async () => release())
      await ring(20)
      expect(screen.queryByRole('status', { name: strings.common.loading })).not.toBeInTheDocument()
    })

    it('shows an error with Try again when the piece cannot be read, and reads it again on Try again', async () => {
      const { fakes, pieceId } = await startedPiece()
      let failures = 1
      const flaky: Fakes = {
        ...fakes,
        data: {
          ...fakes.data,
          async getPiece(id) {
            if (failures-- > 0) throw new Error('offline')
            return fakes.data.getPiece(id)
          },
        },
      }
      const { user } = renderWithApp(processingPath(pieceId), { fakes: flaky })

      expect(await screen.findByRole('heading', { name: t.loadFailedTitle })).toBeInTheDocument()
      expect(screen.getByText(t.loadFailedText)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: t.backToLibrary })).toHaveAttribute('href', '/library')

      await user.click(screen.getByRole('button', { name: strings.common.retry }))

      await ring(20)
      expect(screen.queryByRole('heading', { name: t.loadFailedTitle })).not.toBeInTheDocument()
    })
  })
})
