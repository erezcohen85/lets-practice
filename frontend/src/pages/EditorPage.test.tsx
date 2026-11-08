import { confirmPieceChange, turnOnPieceEditing } from '@/test/pieceChange'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { formatClock } from '@/components/waveform/dockLayout'
import { formatOffset } from '@/domain/barLabel'
import { expandPlayOrder } from '@/domain/playOrder'
import { unmatchedSlots } from '@/domain/renumber'
import { type PageLayer, type PieceMap } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { barWithPass, strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const CLARK = 'piece-clark-county'
const CLARK_TITLE = 'Clark County Celebration'
const text = strings.editor
const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
// One page wide at zoom 1 (the scroll container minus 16 px of padding each side): one image pixel is one screen pixel.
const COLUMN = PAGE_WIDTH + 2 * 16

/**
 * The Clark County piece of the demo seed with the Editor open on the part at `partIndex` (0 clarinet, 1 trumpet, 2 flute).
 * The fill of empty bars is off (the processor cannot fit them) unless `fill` is true, so the tests that check the banner and
 * Realign see the bars an edit leaves without a time.
 */
async function open(partIndex = 0, fakes: Fakes = createFakes({ seed: 'demo' }), fill = false) {
  if (!fill) vi.spyOn(fakes.processor, 'fillEmptyBars').mockResolvedValue(null)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const detail = (await fakes.data.getPiece(CLARK))!
  const map = (await fakes.data.getPieceMap(CLARK))!
  const partId = detail.parts[partIndex].id
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${partId}`, { fakes })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  return { ...view, fakes, map, detail, partId, part: map.pages[partIndex] }
}

const page = (index = 0) => {
  const el = document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, right: PAGE_WIDTH, bottom: PAGE_HEIGHT, x: 0, y: 0, toJSON() {} })
  return el
}
const boxes = () => document.querySelectorAll('[data-slot="bar-box"]')
const mode = (name: string) => screen.getByRole('button', { name })
const status = () => document.querySelector<HTMLElement>('[data-slot="editor-status"]')!
const saved = async (fakes: Fakes): Promise<PieceMap> => (await fakes.data.getPieceMap(CLARK))!

function click(el: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y })
  fireEvent.pointerUp(el, { clientX: x, clientY: y })
}

/** Adds a bar line in the middle of the bar after `index` of the part, on the page it sits on (Add mode). */
async function splitMiddleOf(user: Awaited<ReturnType<typeof open>>['user'], part: PageLayer, index: number) {
  await user.click(mode(text.modes.add))
  const box = part.bars[index]
  click(page(box.pageIndex), box.x + box.w / 2, box.y + 50)
}

async function choosePart(user: Awaited<ReturnType<typeof open>>['user'], name: string) {
  await user.click(screen.getByRole('button', { name: /^(Clarinet|Trumpet|Flute)/ }))
  await user.click(await screen.findByRole('menuitemradio', { name }))
}

/** Lets the fake realign job run through its stages: one read a second, until the button stops saying "Realigning". */
async function finishRealign() {
  for (let i = 0; i < 10 && screen.queryByRole('button', { name: text.status.realigning }) !== null; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('opening the Editor', () => {
  it('opens Clark County on the Clarinet: 64 boxes on 4 pages, the title and the way back to the hub', async () => {
    const { part } = await open()

    expect(screen.getAllByRole('img', { name: /^Page \d of 4$/ })).toHaveLength(4)
    expect(boxes()).toHaveLength(64)
    expect(part.bars).toHaveLength(64)
    expect(screen.getByRole('heading', { level: 1, name: CLARK_TITLE })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: text.pieceHub })).toHaveAttribute('href', `/pieces/${CLARK}`)
    expect(screen.getByRole('button', { name: 'Clarinet in B♭ 1' })).toBeInTheDocument()
    expect(screen.getByText(strings.score.pageLabel(1, 4, '1', '16'))).toBeInTheDocument()
  })

  it('opens on the first part when ?part= is missing or unknown', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
    renderWithApp(`/pieces/${CLARK}/edit?part=nope`, { seed: 'demo' })

    await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
    expect(screen.getByRole('button', { name: 'Clarinet in B♭ 1' })).toBeInTheDocument()
    expect(boxes()).toHaveLength(64)
  })

  it('has the Edit sheet, the Structure strip collapsed, and the Review Queue', async () => {
    await open()

    expect(screen.getByRole('region', { name: text.sheet })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.structure.title })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('heading', { name: strings.review.queue.title })).toBeInTheDocument()
    expect(screen.queryByText(/Press N for the next one/)).toBeNull()
  })

  it('says nothing about moving in Move mode, in the hint line or the status line (Erez removed both hints)', async () => {
    await open()

    const hint = document.querySelector<HTMLElement>('[data-slot="edit-hint"]')!
    expect(hint).toBeEmptyDOMElement()
    expect(status()).toBeEmptyDOMElement()
    expect(document.body).not.toHaveTextContent('Drag a bar line to move it')
    expect(document.body).not.toHaveTextContent('Click a bar to select it.')
  })

  it('shows a skeleton score while it loads', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
    renderWithApp(`/pieces/${CLARK}/edit`, { seed: 'demo' })

    expect(screen.getByRole('status', { name: strings.common.loading })).toBeInTheDocument()
    await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
    expect(screen.queryByRole('status', { name: strings.common.loading })).toBeNull()
  })

  it('shows Not found for an unknown piece', async () => {
    renderWithApp('/pieces/nope/edit', { seed: 'demo' })

    expect(await screen.findByRole('heading', { name: strings.common.notFoundTitle })).toBeInTheDocument()
  })

  it('sends a piece that is still processing to its processing route, replacing the edit entry', async () => {
    const { router } = renderWithApp('/pieces/piece-slow-waltz/edit', { seed: 'demo' })

    await waitFor(() => expect(router.state.location.pathname).toBe('/pieces/piece-slow-waltz/processing'))
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('shows an error with Try again when the map fails to load, and opens after Try again', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.data, 'getPieceMap').mockRejectedValueOnce(new Error('offline'))
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
    const { user } = renderWithApp(`/pieces/${CLARK}/edit`, { fakes })

    expect(await screen.findByRole('heading', { name: text.loadErrorTitle })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
    expect(boxes()).toHaveLength(64)
  })
})

describe('the part chip', () => {
  it('remembers the part it opened, and the part it is switched to', async () => {
    const { fakes, detail, user } = await open(1)
    await waitFor(() => expect(fakes.store.pieces.get(CLARK)?.lastPartId).toBe(detail.parts[1].id))

    await user.click(screen.getByRole('button', { name: detail.parts[1].name }))
    await user.click(within(screen.getByRole('menu', { name: text.partMenu })).getAllByRole('menuitemradio')[2])

    await waitFor(() => expect(fakes.store.pieces.get(CLARK)?.lastPartId).toBe(detail.parts[2].id))
  })

  it('lists the parts, and choosing one sets ?part= by replacing the entry', async () => {
    const { user, router, detail } = await open()

    await user.click(screen.getByRole('button', { name: 'Clarinet in B♭ 1' }))
    const items = within(screen.getByRole('menu', { name: text.partMenu })).getAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual(['Clarinet in B♭ 1', 'Trumpet in B♭ 2', 'Flute 1'])
    await user.click(items[1])

    await waitFor(() => expect(boxes()).toHaveLength(63))
    expect(router.state.location.search).toBe(`?part=${detail.parts[1].id}`)
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.getByRole('button', { name: 'Trumpet in B♭ 2' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('the top bar', () => {
  it('has Practice as a link carrying the part and the first bar of the page in view, and Edit as the current page', async () => {
    const { partId } = await open()

    expect(screen.getByRole('link', { name: strings.common.viewPractice })).toHaveAttribute('href', `/pieces/${CLARK}/practice?part=${partId}&bar=1`)
    expect(screen.getByRole('link', { name: strings.common.viewEdit })).toHaveAttribute('aria-current', 'page')
  })

  it('zooms the score with the buttons and with the + and - keys, but not while typing', async () => {
    const { user } = await open()
    expect(screen.getByText('100%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: strings.score.zoomIn }))
    expect(screen.getByText('110%')).toBeInTheDocument()
    await user.keyboard('+')
    expect(screen.getByText('125%')).toBeInTheDocument()
    await user.keyboard('-')
    await user.click(screen.getByRole('button', { name: strings.score.zoomOut }))
    expect(screen.getByText('100%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: strings.structure.title }))
    await user.click(screen.getByRole('tab', { name: `${strings.structure.sections.rests} (${strings.structure.groups.part('Clarinet in B♭ 1')})` }))
    const field = screen.getByLabelText(strings.structure.marks.rowFrom(1))
    await user.clear(field)
    await user.keyboard('+')
    expect(field).toHaveValue('+')
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})

describe('the score', () => {
  it('marks the bar clicked in Move mode as selected, and a click elsewhere moves the selection', async () => {
    const { user, part } = await open()
    const bar5 = part.bars[4]
    const bar6 = part.bars[5]

    click(page(bar5.pageIndex), bar5.x + bar5.w / 2, bar5.y + 50)
    expect(document.querySelector('[data-bar="5"]')).toHaveAttribute('data-state', 'selected')

    click(page(bar6.pageIndex), bar6.x + bar6.w / 2, bar6.y + 50)
    expect(document.querySelector('[data-bar="5"]')).toHaveAttribute('data-state', 'rest') // a clarinet rest bar
    expect(document.querySelector('[data-bar="6"]')).toHaveAttribute('data-state', 'selected')
    await user.click(mode(text.modes.add))
    expect(document.querySelector('[data-bar="6"]')).toHaveAttribute('data-state', 'selected')
  })
})

describe('a part whose bar lines differ from the piece', () => {
  it('shows the bar-count problem on the Trumpet, and adding the missing line inside bar 22 clears it', async () => {
    const { user, fakes, map } = await open()
    await choosePart(user, 'Trumpet in B♭ 2')
    await waitFor(() => expect(boxes()).toHaveLength(63))
    const trumpet = map.pages[1]

    expect(status()).toHaveTextContent(text.status.partBars('Trumpet in B♭ 2', 63, 64))
    expect(within(status()).getByRole('button', { name: text.status.openStructure })).toBeInTheDocument()

    const wide = trumpet.bars.find((box) => box.w > trumpet.bars[0].w * 1.5)!
    expect(wide.bar).toBe(22)
    await splitMiddleOf(user, trumpet, 21)

    await waitFor(() => expect(boxes()).toHaveLength(64))
    expect(status()).not.toHaveTextContent(/the piece has/)
    await waitFor(async () => expect((await saved(fakes)).pages[1].bars).toHaveLength(64))
    const after = await saved(fakes)
    expect(after.timing).toEqual(map.timing)
    expect(after.pages[0]).toEqual(map.pages[0])
  })

  it('calls the part misread, and Fix its bars opens This part > Bars, not a piece edit', async () => {
    const { user, part } = await open()
    await splitMiddleOf(user, part, 1)

    await waitFor(() => expect(status()).toHaveTextContent(text.status.partBars('Clarinet in B♭ 1', 65, 64)))
    expect(status()).toHaveTextContent(text.status.guideMisread('Clarinet in B♭ 1', 1))
    expect(within(status()).queryByRole('button', { name: text.status.editPiece })).toBeNull()
    await user.click(within(status()).getByRole('button', { name: text.status.openStructure }))

    const panel = screen.getByRole('region', { name: strings.structure.title })
    // This part > Bars: Detected is the count when the Editor opened, Now the part's own boxes; no piece box.
    expect(within(panel).getByRole('heading', { name: strings.structure.partBarsHeading('Clarinet in B♭ 1') })).toBeInTheDocument()
    expect(within(panel).getByText(strings.structure.bars.count(65))).toBeInTheDocument()
    expect(within(panel).queryByText(strings.structure.bars.pieceTitle)).toBeNull()
  })

  it('a bar inserted in the piece only makes the other parts differ and leaves a bar without a time', async () => {
    const { user, fakes, part } = await open()
    await splitMiddleOf(user, part, 1)
    await waitFor(() => expect(status()).toHaveTextContent(text.status.partBars('Clarinet in B♭ 1', 65, 64)))

    await insertPieceBarAfter2(user)

    await waitFor(() => expect(status()).toHaveTextContent(text.status.unmatched(1)))
    expect(status()).not.toHaveTextContent(/the piece has/)
    expect(within(status()).getByRole('button', { name: text.status.realign })).toBeEnabled()
    expect(document.querySelectorAll('[data-state="unmatched"]')).toHaveLength(1)
    await waitFor(async () => expect((await saved(fakes)).timing.barCount).toBe(65))

    await choosePart(user, 'Trumpet in B♭ 2')
    await waitFor(() => expect(status()).toHaveTextContent(text.status.partBars('Trumpet in B♭ 2', 63, 65)))
    await choosePart(user, 'Flute 1')
    await waitFor(() => expect(status()).toHaveTextContent(text.status.partBars('Flute 1', 64, 65)))
  })
})

/** Structure > Piece > Bars: "Insert a bar after bar 2", in the piece only, confirmed. */
async function insertPieceBarAfter2(user: Awaited<ReturnType<typeof open>>['user']) {
  await turnOnPieceEditing(user)
  if (screen.queryByRole('tab', { name: strings.structure.sections.bars }) === null) await user.click(screen.getByRole('button', { name: strings.structure.title }))
  await user.click(screen.getByRole('tab', { name: strings.structure.sections.bars }))
  const panel = screen.getByRole('region', { name: strings.structure.title })
  await user.type(within(panel).getByLabelText(strings.structure.bars.insertField), '2')
  await user.click(within(panel).getByRole('button', { name: strings.structure.bars.insertApply }))
  await confirmPieceChange(user)
}

describe('Realign', () => {
  /** Clarinet, a bar split and a bar inserted after bar 2, so one bar has no time. */
  async function withUnmatchedBar() {
    const context = await open()
    await splitMiddleOf(context.user, context.part, 1)
    await waitFor(() => expect(status()).toHaveTextContent(/the piece has/))
    await insertPieceBarAfter2(context.user)
    await waitFor(() => expect(status()).toHaveTextContent(text.status.unmatched(1)))
    return context
  }

  it('shows Realigning, disabled, while the job runs, then fills the slot and clears the status', async () => {
    const { fakes } = await withUnmatchedBar()
    await waitFor(async () => expect(unmatchedSlots((await saved(fakes)).timing)).toHaveLength(1))

    fireEvent.click(within(status()).getByRole('button', { name: text.status.realign }))

    const busy = await screen.findByRole('button', { name: text.status.realigning })
    expect(busy).toBeDisabled()
    await finishRealign()

    await waitFor(() => expect(status()).not.toHaveTextContent(/no time in the recording/))
    expect(screen.queryByRole('button', { name: text.status.realign })).toBeNull()
    expect(document.querySelectorAll('[data-state="unmatched"]')).toHaveLength(0)
    await waitFor(async () => expect(unmatchedSlots((await saved(fakes)).timing)).toHaveLength(0))
    expect(screen.getByRole('button', { name: 'Undo: realign' })).toBeEnabled()
  })

  it('disables the Structure forms while the job runs, with a note, and enables them when it is done', async () => {
    await withUnmatchedBar()
    const panel = screen.getByRole('region', { name: strings.structure.title })
    expect(within(panel).getByRole('button', { name: strings.structure.bars.insertApply })).toBeEnabled()

    fireEvent.click(within(status()).getByRole('button', { name: text.status.realign }))

    await screen.findByRole('button', { name: text.status.realigning })
    expect(within(panel).getByText(strings.structure.busy)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: strings.structure.bars.insertApply })).toBeDisabled()
    expect(within(panel).getByRole('button', { name: strings.structure.bars.removeApply })).toBeDisabled()
    await finishRealign()

    await waitFor(() => expect(within(panel).getByRole('button', { name: strings.structure.bars.insertApply })).toBeEnabled())
    expect(within(panel).queryByText(strings.structure.busy)).toBeNull()
  })

  it('is one undo step: Undo brings the unmatched bar back, and saves the earlier locators', async () => {
    const { user, fakes } = await withUnmatchedBar()
    fireEvent.click(within(status()).getByRole('button', { name: text.status.realign }))
    await finishRealign()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo: realign' })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: 'Undo: realign' }))

    await waitFor(() => expect(status()).toHaveTextContent(text.status.unmatched(1)))
    await waitFor(async () => expect(unmatchedSlots((await saved(fakes)).timing)).toHaveLength(1))
  })

  it('waits for a save in progress before it asks the processor', async () => {
    const { fakes } = await withUnmatchedBar()
    await waitFor(async () => expect(unmatchedSlots((await saved(fakes)).timing)).toHaveLength(1))
    const realign = vi.spyOn(fakes.processor, 'realign')
    const original = fakes.data.saveTiming.bind(fakes.data)
    let release = () => {}
    vi.spyOn(fakes.data, 'saveTiming').mockImplementationOnce(
      (id, timing) => new Promise<void>((resolve) => (release = () => void original(id, timing).then(resolve))),
    )
    // A Structure edit, saved slowly: Remove bar 3 (the bar just inserted).
    const panel = screen.getByRole('region', { name: strings.structure.title })
    const field = within(panel).getByLabelText(strings.structure.bars.removeField)
    fireEvent.change(field, { target: { value: '3' } })
    fireEvent.click(within(panel).getByRole('button', { name: strings.structure.bars.removeApply }))
    await confirmPieceChange()
    await waitFor(() => expect(status()).not.toHaveTextContent(/no time in the recording/))

    fireEvent.click(within(status()).getByRole('button', { name: text.status.realign }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(realign).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: text.status.realigning })).toBeDisabled()

    await act(async () => release())
    await waitFor(() => expect(realign).toHaveBeenCalledTimes(1))
    await finishRealign()
    expect(screen.queryByRole('button', { name: text.status.realigning })).toBeNull()
  })

  it('stays locked when the first read of the new map fails, tries again, and then fills the slot', async () => {
    const { fakes } = await withUnmatchedBar()
    await waitFor(async () => expect(unmatchedSlots((await saved(fakes)).timing)).toHaveLength(1))
    const read = vi.spyOn(fakes.data, 'getPieceMap').mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))

    fireEvent.click(within(status()).getByRole('button', { name: text.status.realign }))
    await screen.findByRole('button', { name: text.status.realigning })
    await finishRealign()

    // The refit is not thrown away: the doc took the new timing, no error was shown, and the failed reads were tried again.
    await waitFor(() => expect(status()).not.toHaveTextContent(/no time in the recording/))
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(status()).not.toHaveTextContent(text.status.realignFailed)
    expect(status()).not.toHaveTextContent(text.status.realignReload)
    expect(screen.queryByRole('button', { name: text.status.realigning })).toBeNull()
    await waitFor(async () => expect(unmatchedSlots((await saved(fakes)).timing)).toHaveLength(0))
  })

  it('says the screen is out of date, and to reload, when the new map cannot be read at all', async () => {
    const { fakes } = await withUnmatchedBar()
    vi.spyOn(fakes.data, 'getPieceMap').mockRejectedValue(new Error('offline'))

    fireEvent.click(within(status()).getByRole('button', { name: text.status.realign }))
    await screen.findByRole('button', { name: text.status.realigning })
    await finishRealign()

    await waitFor(() => expect(status()).toHaveTextContent(text.status.realignReload))
    // The old times are still on the screen, so nothing says the realign "failed" and can be tried again as if it had not run.
    expect(status()).not.toHaveTextContent(text.status.realignFailed)
  })

  it('shows the error of a failed job in the status line and offers Realign again', async () => {
    const fakes = createFakes({ seed: 'demo', failStage: 'align' })
    const { user, part } = await open(0, fakes)
    await splitMiddleOf(user, part, 1)
    await waitFor(() => expect(status()).toHaveTextContent(/the piece has/))
    await insertPieceBarAfter2(user)
    await waitFor(() => expect(status()).toHaveTextContent(text.status.unmatched(1)))

    fireEvent.click(within(status()).getByRole('button', { name: text.status.realign }))
    await finishRealign()

    await waitFor(() => expect(status()).toHaveTextContent('align failed: fake failure'))
    expect(within(status()).getByRole('button', { name: text.status.realign })).toBeEnabled()
    expect(status()).toHaveTextContent(text.status.unmatched(1))
  })
})

describe('when saving fails', () => {
  it('puts Not saved with Retry first in the status line', async () => {
    const { user, fakes, part } = await open()
    vi.spyOn(fakes.data, 'savePageLayer').mockRejectedValueOnce(new Error('offline'))

    await splitMiddleOf(user, part, 1)

    expect(await within(status()).findByText(text.notSaved)).toBeInTheDocument()
    expect(status().firstElementChild).toHaveTextContent(text.notSaved)
    await user.click(within(status()).getByRole('button', { name: text.retrySave }))
    await waitFor(() => expect(within(status()).queryByText(text.notSaved)).toBeNull())
  })
})

describe('the notice for touch and narrow screens', () => {
  // An iPad of 820 px: narrower than 1024 px, but past the phone rule (which would close the editor).
  function narrow() {
    vi.stubGlobal(
      'matchMedia',
      (query: string) => ({ matches: query === '(max-width: 1023px)', media: query, addEventListener() {}, removeEventListener() {} }),
    )
  }

  it('shows once above the score at 820 px, and stays dismissed when the part changes', async () => {
    narrow()
    const { user } = await open()

    expect(screen.getByText(text.ipad.notice)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: text.ipad.dismiss }))
    expect(screen.queryByText(text.ipad.notice)).toBeNull()

    await choosePart(user, 'Trumpet in B♭ 2')
    await waitFor(() => expect(boxes()).toHaveLength(63))
    expect(screen.queryByText(text.ipad.notice)).toBeNull()
  })

  it('does not show on a wide screen with a mouse', async () => {
    await open()

    expect(screen.queryByText(text.ipad.notice)).toBeNull()
  })
})

describe('the waveform dock', () => {
  const dock = strings.dock
  const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!

  it('sits under the Structure strip, with the demo piece\'s 72 locators and 5 open items', async () => {
    await open()

    const region = await screen.findByRole('region', { name: dock.region })
    expect(screen.getByRole('button', { name: dock.filterAll(72) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: dock.filterReview(5) })).toBeInTheDocument()
    const structure = screen.getByRole('region', { name: strings.structure.title })
    expect(structure.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('selects a locator line and shows its bar in the chip', async () => {
    const { map } = await open()
    await screen.findByRole('region', { name: dock.region })
    const first = [...map.timing.locators].sort((a, b) => a.timeSec - b.timeSec)[0]
    // The recording of the fakes is 60 s here, so the window holds 12 s from 0 and its 1000 px are 12 s.
    stage().getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 150, right: 1000, bottom: 150, x: 0, y: 0, toJSON() {} })

    fireEvent.pointerDown(stage(), { clientX: (first.timeSec / 12) * 1000, clientY: 60 })

    expect(await screen.findByLabelText(dock.barChipLabel)).toHaveTextContent(`Bar ${first.bar}`)
  })

  it('plays and pauses with Space once the recording has loaded', async () => {
    const { user } = await open()
    const play = await screen.findByRole('button', { name: dock.play })
    await waitFor(() => expect(play).toBeEnabled())

    await user.keyboard(' ')

    expect(await screen.findByRole('button', { name: dock.pause })).toBeInTheDocument()
    await user.keyboard(' ')
    expect(await screen.findByRole('button', { name: dock.play })).toBeInTheDocument()
  })

  it('zooms the waveform with Shift + / - and the score with the plain keys', async () => {
    const { user } = await open()
    await screen.findByRole('region', { name: dock.region })

    await user.keyboard('{Shift>}{+}{/Shift}')
    expect(stage().dataset.viewSpan).toBe('8')
    expect(screen.getByText('100%')).toBeInTheDocument()

    await user.keyboard('=')
    expect(screen.getByText('110%')).toBeInTheDocument()
    expect(stage().dataset.viewSpan).toBe('8')
  })
})

describe('locator edits on the waveform', () => {
  const dock = strings.dock
  const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
  // The stage is 1000 px; the tests zoom the waveform out to 30 s, which holds the first seven locators (4 s apart).
  const x = (t: number) => (t / 30) * 1000
  const down = (t: number, init: object = {}) => fireEvent.pointerDown(stage(), { clientX: x(t), clientY: 60, ...init })
  const move = (t: number) => fireEvent.pointerMove(stage(), { clientX: x(t), clientY: 60 })
  const up = (t: number, init: object = {}) => fireEvent.pointerUp(stage(), { clientX: x(t), clientY: 60, ...init })
  const sameSlot = (a: { bar: number; passIndex: number }) => (b: { bar: number; passIndex: number }) => a.bar === b.bar && a.passIndex === b.passIndex

  /** The Editor with the dock ready; the locators of the piece in time order. */
  async function openDock() {
    const view = await open()
    await screen.findByRole('region', { name: dock.region })
    await view.user.keyboard('{Shift>}{-}{-}{/Shift}')
    expect(stage().dataset.viewSpan).toBe('30')
    stage().getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 150, right: 1000, bottom: 150, x: 0, y: 0, toJSON() {} })
    const sorted = [...view.map.timing.locators].sort((a, b) => a.timeSec - b.timeSec)
    return { ...view, sorted }
  }
  const savedLocators = async (fakes: Fakes) => (await saved(fakes)).timing.locators
  const undoButton = () => screen.getByRole('button', { name: /^(Undo|Nothing to undo)/ })
  // A click on empty waveform moves the play line; it adds a locator only with Add locator on (Decisions 2026-11-06).
  const addLocatorOn = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: dock.addLocator }))

  it('drags a locator: saved at once, confirmed, one step, with the moved feedback on the dock and the score; Undo puts it back', async () => {
    const { user, fakes, sorted } = await openDock()
    const target = sorted[3]
    const to = target.timeSec + 0.4 * (sorted[4].timeSec - target.timeSec)

    down(target.timeSec)
    move((target.timeSec + to) / 2)
    move(to)
    up(to)

    await waitFor(async () => {
      const now = (await savedLocators(fakes)).find(sameSlot(target))!
      expect(now.timeSec).toBeCloseTo(to, 1)
      expect(now.confirmed).toBe(true)
    })
    const offset = formatOffset((await savedLocators(fakes)).find(sameSlot(target))!.timeSec - target.timeSec)
    expect(status()).toHaveTextContent('1 bar line moved by hand. Not resolved yet.')
    expect(screen.getByLabelText(dock.movedChipLabel)).toHaveTextContent('1 moved')
    expect(screen.getByText(dock.movedTag(barWithPass(String(target.bar), target.passIndex), offset))).toBeInTheDocument()
    expect(screen.getByText(strings.score.movedTag(String(target.bar), offset))).toBeInTheDocument()
    expect(document.querySelector(`[data-slot="bar-box"][data-bar="${target.bar}"]`)).toHaveAttribute('data-state', 'moved')
    // The dragged line is selected too: the amber outline shows over the moved tint.
    expect(document.querySelector(`[data-slot="bar-box"][data-bar="${target.bar}"]`)!.className).toContain('border-paper-selected')
    // The dock has no explanatory hint any more: the dashed "was" line and the moved tag say it.
    expect(screen.queryByText('Grey dashed lines show where each bar line was.')).toBeNull()
    expect(undoButton()).toHaveAccessibleName(/move locator/)

    await user.click(undoButton())

    await waitFor(async () => expect((await savedLocators(fakes)).find(sameSlot(target))).toEqual(target))
    expect(status()).not.toHaveTextContent('moved by hand')
    expect(screen.queryByLabelText(dock.movedChipLabel)).toBeNull()
  })

  it('Shift+Delete (the Renumber switch is on) leaves the bar empty, then a click adds it back to the free bar; Undo takes each step back', async () => {
    const { user, fakes, sorted } = await openDock()
    const target = sorted[3]

    down(target.timeSec)
    up(target.timeSec)
    await user.keyboard('{Shift>}{Delete}{/Shift}')

    await waitFor(async () => expect(await savedLocators(fakes)).toHaveLength(sorted.length - 1))
    expect(status()).toHaveTextContent(text.status.unmatched(1))

    const middle = (sorted[2].timeSec + sorted[4].timeSec) / 2
    await addLocatorOn(user)
    down(middle)
    up(middle)

    await waitFor(async () => expect(await savedLocators(fakes)).toHaveLength(sorted.length))
    const added = (await savedLocators(fakes)).find((l) => Math.abs(l.timeSec - middle) < 1e-6)!
    expect(added).toMatchObject({ bar: target.bar, passIndex: target.passIndex, confirmed: true })

    await user.click(undoButton())
    await user.click(undoButton())
    await waitFor(async () => expect(await savedLocators(fakes)).toEqual(sorted))
  })

  it('a click (the Renumber switch is on) adds a locator and moves the bars after it one forward', async () => {
    const { user, fakes, sorted, map } = await openDock()
    const slots = expandPlayOrder(map.timing.playOrder, map.timing.barCount)
    const middle = (sorted[2].timeSec + sorted[3].timeSec) / 2

    await addLocatorOn(user)
    down(middle)
    up(middle)

    const position = (l: { bar: number; passIndex: number }) => slots.findIndex(sameSlot(l))
    await waitFor(async () => {
      const now = await savedLocators(fakes)
      const added = now.find((l) => Math.abs(l.timeSec - middle) < 1e-6)!
      expect(position(added)).toBe(position(sorted[2]) + 1)
      expect(position(now.find((l) => l.timeSec === sorted[3].timeSec)!)).toBe(position(sorted[3]) + 1)
    })
  })

  it('refuses a Shift+click add (plain) that has no free bar: the reason shows in the hint line for 3 s and nothing is recorded', async () => {
    const { user, fakes, sorted } = await openDock()
    const middle = (sorted[3].timeSec + sorted[4].timeSec) / 2

    await addLocatorOn(user)
    down(middle, { shiftKey: true })
    up(middle, { shiftKey: true })

    expect(await screen.findByText(strings.review.refusals['no-free-slot'])).toBeInTheDocument()
    expect(undoButton()).toHaveAccessibleName(strings.history.nothingToUndo)
    expect(await savedLocators(fakes)).toEqual(sorted)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(screen.queryByText(strings.review.refusals['no-free-slot'])).toBeNull()
  })

  it('shows no hint over the waveform, with Add locator off or on', async () => {
    const { user } = await openDock()

    fireEvent.pointerEnter(stage())
    expect(document.querySelector('section[aria-label="Waveform"] p')).toBeNull()

    await addLocatorOn(user)
    fireEvent.pointerEnter(stage())

    expect(document.querySelector('section[aria-label="Waveform"] p')).toBeNull()
  })

  it('a plain click on empty waveform moves the play line and records nothing', async () => {
    const { fakes, sorted } = await openDock()
    const middle = (sorted[2].timeSec + sorted[3].timeSec) / 2

    down(middle)
    up(middle)

    expect(screen.getByLabelText(dock.timeLabel)).toHaveTextContent(formatClock(middle))
    expect(undoButton()).toHaveAccessibleName(strings.history.nothingToUndo)
    expect(await savedLocators(fakes)).toEqual(sorted)
  })

  it('relabels by typing a bar number: Enter opens the field, Enter applies, Undo restores', async () => {
    const { user, fakes, sorted, map } = await openDock()
    const slots = expandPlayOrder(map.timing.playOrder, map.timing.barCount)
    const target = sorted[2]
    const next = slots[slots.findIndex(sameSlot(target)) + 1]

    down(target.timeSec)
    up(target.timeSec)
    stage().focus()
    await user.keyboard('{Enter}')
    const field = screen.getByRole('textbox', { name: dock.relabelField })
    expect(field).toHaveValue(barWithPass(String(target.bar), target.passIndex))
    await user.clear(field)
    await user.type(field, `${barWithPass(String(next.bar), next.passIndex)}{Enter}`)

    await waitFor(async () => {
      const now = (await savedLocators(fakes)).find((l) => l.timeSec === target.timeSec)!
      expect(now).toMatchObject({ bar: next.bar, passIndex: next.passIndex })
    })
    expect(screen.queryByRole('textbox', { name: dock.relabelField })).toBeNull()

    await user.click(undoButton())
    await waitFor(async () => expect(await savedLocators(fakes)).toEqual(sorted))
  })

  it('shows an error under the field for a label that is not a bar, and records nothing', async () => {
    const { user, fakes, sorted } = await openDock()

    down(sorted[2].timeSec)
    up(sorted[2].timeSec)
    stage().focus()
    await user.keyboard('{Enter}')
    const field = screen.getByRole('textbox', { name: dock.relabelField })
    await user.clear(field)
    await user.type(field, '9999{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(dock.relabelUnknown)
    expect(undoButton()).toHaveAccessibleName(strings.history.nothingToUndo)
    expect(await savedLocators(fakes)).toEqual(sorted)
  })
})

describe('the Structure panel next to the dock', () => {
  it('floats over the score column instead of pushing it, and closes with Escape', async () => {
    const { user } = await open()
    await screen.findByRole('region', { name: strings.dock.region })

    await user.click(screen.getByRole('button', { name: strings.structure.title, expanded: false }))
    await user.click(screen.getByRole('tab', { name: strings.structure.sections.meters }))

    const body = document.querySelector<HTMLElement>('[data-slot="structure-body"]')!
    expect(body).toHaveClass('absolute')
    expect(screen.getByRole('region', { name: strings.dock.region })).toBeInTheDocument()
    expect(boxes()).toHaveLength(64)

    await user.keyboard('{Escape}')
    expect(document.querySelector('[data-slot="structure-body"]')).toBeNull()
  })
})
