import { act, screen, waitFor, within } from '@testing-library/react'
import { createFakes, type Fakes } from '@/lib/fakes'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// Where the processor has no Realign (features.realign off), the editor says which bars have no time but offers no button.

const CLARK = 'piece-clark-county'
const text = strings.editor
const PAGE_WIDTH = 1240
const COLUMN = PAGE_WIDTH + 2 * 16

async function open(features?: { realign: boolean }, fakes: Fakes = createFakes({ seed: 'demo' })) {
  vi.spyOn(fakes.processor, 'fillEmptyBars').mockResolvedValue(null)
  // Bar 10 loses its time, as after a structure edit.
  const map = fakes.store.maps.get(CLARK)!
  map.timing = { ...map.timing, locators: map.timing.locators.filter((locator) => !(locator.bar === 10 && locator.passIndex === 0)) }
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const partId = (await fakes.data.getPiece(CLARK))!.parts[0].id
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${partId}`, { fakes, ...(features === undefined ? {} : { features }) })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 5000 })
  return view
}

const status = () => document.querySelector<HTMLElement>('[data-slot="editor-status"]')!

afterEach(() => vi.restoreAllMocks())

describe('the Editor where Realign is off', () => {
  it('control: with Realign on, the bar without a time has Realign in the status line and in its card', async () => {
    const { user } = await open()

    expect(status()).toHaveTextContent(text.status.unmatched(1))
    expect(within(status()).getByRole('button', { name: text.status.realign })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Bar 10\b/ }))
    expect(screen.getAllByRole('button', { name: text.status.realign })).toHaveLength(2)
  })

  it('offers no Realign button in the status line or in the bar card, and still says the bar has no time', async () => {
    const { user } = await open({ realign: false })

    expect(status()).toHaveTextContent(text.status.unmatched(1))
    await user.click(screen.getByRole('button', { name: /^Bar 10\b/ }))
    expect(screen.getByText(strings.review.explain.unmatched('10'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: text.status.realign })).not.toBeInTheDocument()
  })
})

describe('Realign where the processor refuses', () => {
  it('tells the owner why when the piece is busy, in the processor\'s own sentence', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.processor, 'realign').mockRejectedValue(new SentenceError(strings.realServices.stillPreparing))
    const { user } = await open(undefined, fakes)

    await user.click(within(status()).getByRole('button', { name: text.status.realign }))

    await waitFor(() => expect(status()).toHaveTextContent(strings.realServices.stillPreparing))
    expect(status()).not.toHaveTextContent(text.status.realignFailed)
  })

  it('says the plain failure for any other error', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.processor, 'realign').mockRejectedValue(new Error('offline'))
    const { user } = await open(undefined, fakes)

    await user.click(within(status()).getByRole('button', { name: text.status.realign }))

    await waitFor(() => expect(status()).toHaveTextContent(text.status.realignFailed))
  })
})

describe('Realign when its job stops changing', () => {
  afterEach(() => vi.useRealTimers())

  /** A realign job the screen reads as `current()` says; `finish()` ends it and lets the map carry a new time for bar 10. */
  async function stalledRealign() {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fakes = createFakes({ seed: 'demo' })
    const job = { id: 'job-slow', pieceId: CLARK, kind: 'realign' as const, status: 'running' as const, progress: 0.5, error: null }
    let current: typeof job | { status: 'done'; progress: 1; id: string; pieceId: string; kind: 'realign'; error: null } = job
    vi.spyOn(fakes.processor, 'realign').mockResolvedValue(job)
    vi.spyOn(fakes.data, 'getJob').mockImplementation(async () => current as never)
    const view = await open(undefined, fakes)
    await view.user.click(within(status()).getByRole('button', { name: text.status.realign }))
    await screen.findByRole('button', { name: text.status.realigning })
    return {
      ...view,
      fakes,
      finish() {
        // The processor's result: bar 10 gets its time.
        const map = fakes.store.maps.get(CLARK)!
        map.timing = { ...map.timing, locators: [...map.timing.locators, { bar: 10, passIndex: 0, timeSec: 20, confirmed: false }] }
        current = { ...job, status: 'done', progress: 1 }
      },
    }
  }

  it('shows the slow note in a calm colour, not as an error', async () => {
    await stalledRealign()
    await act(() => vi.advanceTimersByTimeAsync(11 * 60 * 1000))

    const note = await screen.findByText(text.status.realignSlow)

    expect(note).not.toHaveClass('text-problem')
  })

  it('says so after ten minutes, keeps waiting and keeps Structure locked', async () => {
    const { user } = await stalledRealign()
    await act(() => vi.advanceTimersByTimeAsync(9 * 60 * 1000))
    expect(status()).not.toHaveTextContent(text.status.realignSlow)

    await act(() => vi.advanceTimersByTimeAsync(61 * 1000))

    await waitFor(() => expect(status()).toHaveTextContent(text.status.realignSlow))
    expect(screen.getByRole('button', { name: text.status.realigning })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: strings.structure.title }))
    const panel = screen.getByRole('region', { name: strings.structure.title })
    expect(within(panel).getByText(strings.structure.busy)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: strings.structure.bars.insertApply })).toBeDisabled()
  })

  it('loads the result when the job does end, clears the note and unlocks Structure', async () => {
    const { user, finish } = await stalledRealign()
    await act(() => vi.advanceTimersByTimeAsync(11 * 60 * 1000))
    await waitFor(() => expect(status()).toHaveTextContent(text.status.realignSlow))

    finish()
    await act(() => vi.advanceTimersByTimeAsync(3000))

    await waitFor(() => expect(status()).not.toHaveTextContent(text.status.realignSlow))
    await waitFor(() => expect(status()).not.toHaveTextContent(text.status.unmatched(1)))
    expect(screen.getByRole('button', { name: 'Undo: realign' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: strings.structure.title }))
    const panel = screen.getByRole('region', { name: strings.structure.title })
    expect(within(panel).queryByText(strings.structure.busy)).not.toBeInTheDocument()
  })

  it('does not give up the wait on one failed read: the lock stays, and the end still loads the result', async () => {
    const { user, fakes, finish } = await stalledRealign()
    vi.mocked(fakes.data.getJob).mockRejectedValueOnce(new Error('offline'))
    await act(() => vi.advanceTimersByTimeAsync(3000))

    expect(status()).not.toHaveTextContent(text.status.realignFailed)
    expect(screen.getByRole('button', { name: text.status.realigning })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: strings.structure.title }))
    const panel = screen.getByRole('region', { name: strings.structure.title })
    expect(within(panel).getByText(strings.structure.busy)).toBeInTheDocument()

    finish()
    await act(() => vi.advanceTimersByTimeAsync(3000))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo: realign' })).toBeEnabled())
    expect(within(panel).queryByText(strings.structure.busy)).not.toBeInTheDocument()
  })

  it('treats a job row that cannot be found yet the same way', async () => {
    const { fakes } = await stalledRealign()
    vi.mocked(fakes.data.getJob).mockResolvedValueOnce(null)
    await act(() => vi.advanceTimersByTimeAsync(3000))

    expect(status()).not.toHaveTextContent(text.status.realignFailed)
    expect(screen.getByRole('button', { name: text.status.realigning })).toBeDisabled()
  })

  it('stops polling when the page is left', async () => {
    const { fakes, unmount } = await stalledRealign()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    unmount()
    const reads = vi.mocked(fakes.data.getJob).mock.calls.length

    await act(() => vi.advanceTimersByTimeAsync(20_000))

    expect(vi.mocked(fakes.data.getJob).mock.calls.length).toBeLessThanOrEqual(reads + 1)
  })
})
