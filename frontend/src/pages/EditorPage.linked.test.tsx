import { selectedLocators } from '@/test/dockSelection'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { formatClock } from '@/components/waveform/dockLayout'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// The linked selection in the real Editor on the demo piece (task 6.7): a locator on the waveform and a bar on the
// score are one selection, in both directions; the score follows to the bar's page; ?bar= opens on a bar; the
// keyboard map lists the keys that are bound.

const CLARK = 'piece-clark-county'
const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
const COLUMN = PAGE_WIDTH + 2 * 16
const dock = strings.dock

async function open(query = '', fakes: Fakes = createFakes({ seed: 'demo' })) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  // The pages sit 1000 px apart in the column, which is 400 px tall.
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return 100 + 1000 * Number(this.dataset.pageIndex ?? 0)
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  const detail = (await fakes.data.getPiece(CLARK))!
  const map = (await fakes.data.getPieceMap(CLARK))!
  const partId = detail.parts[0].id
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${partId}${query}`, { fakes, playerSec: 271 })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  await screen.findByRole('timer', { name: dock.timeLabel })
  return { ...view, fakes, map, partId, part: map.pages[0] }
}

const scroller = () => document.querySelector<HTMLElement>('[data-slot="score-scroll"]')!
const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
const boxState = (bar: number) => document.querySelector(`[data-slot="bar-box"][data-bar="${bar}"]`)!.getAttribute('data-state')
const selectedBars = () => [...document.querySelectorAll('[data-slot="bar-box"][data-state="selected"]')].map((el) => Number(el.getAttribute('data-bar')))
const pageLabel = () => document.querySelector('[data-slot="page-label"]')!.textContent
const practice = () => screen.getByRole('link', { name: strings.common.viewPractice })
const card = (bar: number) => screen.getByRole('button', { name: new RegExp(`^Bar ${bar}\\b`) })

const pageEl = (index: number) => {
  const el = document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, right: PAGE_WIDTH, bottom: PAGE_HEIGHT, x: 0, y: 0, toJSON() {} })
  return el
}
function clickBar(part: { bars: { bar: number; pageIndex: number; x: number; y: number; w: number; h: number }[] }, bar: number) {
  const box = part.bars.find((candidate) => candidate.bar === bar)!
  const x = box.x + box.w / 2
  const y = box.y + 50
  fireEvent.pointerDown(pageEl(box.pageIndex), { clientX: x, clientY: y })
  fireEvent.pointerUp(pageEl(box.pageIndex), { clientX: x, clientY: y })
  return box
}
/** A press on the dock stage at a time, with the stage 1000 px wide over the window it shows now. */
function pressDockAt(timeSec: number) {
  const start = Number(stage().dataset.viewStart)
  const span = Number(stage().dataset.viewSpan)
  const x = ((timeSec - start) / span) * 1000
  stage().getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 150, right: 1000, bottom: 150, x: 0, y: 0, toJSON() {} })
  fireEvent.pointerDown(stage(), { clientX: x, clientY: 60 })
  fireEvent.pointerUp(stage(), { clientX: x, clientY: 60 })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a locator on the waveform and a bar on the score', () => {
  it('selecting a locator selects its bar on the score, scrolls to it and switches the page', async () => {
    const { map, part } = await open()
    // Start on the third page, with the score scrolled there; the dock follows the card to bar 41.
    fireEvent.click(card(41))
    expect(pageLabel()).toBe(strings.score.pageLabel(3, 4, '33', '48'))

    // Bar 6 is on the first page. Its line is on the dock once the window is on bar 5.
    clickBar(part, 5)
    const bar6 = map.timing.locators.find((l) => l.bar === 6 && l.passIndex === 0)!
    pressDockAt(bar6.timeSec)

    expect(selectedBars()).toEqual([6])
    expect(pageLabel()).toBe(strings.score.pageLabel(1, 4, '1', '16'))
    const box = part.bars.find((candidate) => candidate.bar === 6)!
    expect(scroller().scrollTop).toBeCloseTo(100 + box.y + box.h / 2 - 200, 0)
    expect(await screen.findByLabelText(dock.barChipLabel)).toHaveTextContent('Bar 6')
  })

  it('clicking a bar in Move mode selects its locator and moves the dock to it', async () => {
    const { part, map } = await open()

    clickBar(part, 5)

    expect(selectedBars()).toEqual([5])
    expect(selectedLocators()).toEqual(['5:0'])
    const first = map.timing.locators.find((l) => l.bar === 5 && l.passIndex === 0)!
    const start = Number(stage().dataset.viewStart)
    expect(first.timeSec).toBeGreaterThanOrEqual(start)
    expect(first.timeSec).toBeLessThanOrEqual(start + Number(stage().dataset.viewSpan))
    // The score does not jump for a click on a bar that is already in view.
    expect(scroller().scrollTop).toBe(100 - 16)
  })

  it('takes the pass nearest the playhead when the bar is played more than once', async () => {
    const { part, map } = await open()
    const second = map.timing.locators.find((l) => l.bar === 9 && l.passIndex === 1)!
    clickBar(part, 9)
    expect(selectedLocators()).toEqual(['9:0'])

    // A plain click on the waveform seeks (the ruler strip is gone): put the playhead just after the second time through bar 9, then click the bar again.
    const wave = stage()
    wave.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 150, right: 1000, bottom: 150, x: 0, y: 0, toJSON() {} })
    const clientX = ((second.timeSec + 0.3 - Number(wave.dataset.viewStart)) / Number(wave.dataset.viewSpan)) * 1000
    fireEvent.pointerDown(wave, { clientX, clientY: 60 })
    fireEvent.pointerUp(wave, { clientX, clientY: 60 })
    await waitFor(() => expect(screen.getByRole('timer', { name: dock.timeLabel })).not.toHaveTextContent('0:00'))
    clickBar(part, 9)

    expect(selectedLocators()).toEqual(['9:1'])
  })

  // Erez, 2026-11-06: a double click on a bar steps through its repeats, so each time through can be reached from the score.
  it('a double click on a repeated bar goes to its next pass, wraps to the first, and moves the play line to it', async () => {
    const { part, map } = await open()
    const times = [0, 1].map((passIndex) => map.timing.locators.find((l) => l.bar === 9 && l.passIndex === passIndex)!.timeSec)
    const clock = () => screen.getByRole('timer', { name: dock.timeLabel })

    clickBar(part, 9)
    expect(selectedLocators()).toEqual(['9:0'])
    // The first click of the pair already goes to the pass nearest the playhead: it does jump before the second.
    await waitFor(() => expect(clock()).toHaveTextContent(formatClock(times[0])))

    clickBar(part, 9)
    expect(selectedLocators()).toEqual(['9:1'])
    await waitFor(() => expect(clock()).toHaveTextContent(formatClock(times[1])))
    expect(await screen.findByLabelText(dock.barChipLabel)).toHaveTextContent('Bar 9 (2)')

    // Not a double click any more: a pause between the clicks, so this one picks the pass nearest the playhead (the second).
    vi.advanceTimersByTime(400)
    clickBar(part, 9)
    expect(selectedLocators()).toEqual(['9:1'])
    clickBar(part, 9)
    expect(selectedLocators()).toEqual(['9:0'])
    await waitFor(() => expect(clock()).toHaveTextContent(formatClock(times[0])))
  })

  it('a double click on a bar played once stays on it', async () => {
    const { part } = await open()
    clickBar(part, 5)
    clickBar(part, 5)
    expect(selectedLocators()).toEqual(['5:0'])
  })

  it('selects only the bar when it has no locator in any pass', async () => {
    const { part } = await open()
    clickBar(part, 5)
    fireEvent.keyDown(window, { key: 'Delete', shiftKey: true })
    clickBar(part, 6)
    expect(boxState(5)).toBe('unmatched')
    clickBar(part, 5)

    expect(selectedBars()).toEqual([5])
    // Nothing selected on the waveform: it has no hint (Erez removed the idle one).
    expect(document.querySelector('[data-slot="dock-stage"]')).not.toBeNull()
  })

  it('a click elsewhere moves the selection', async () => {
    const { part } = await open()

    clickBar(part, 5)
    clickBar(part, 6)

    expect(boxState(5)).toBe('rest') // the clarinet rests in bars 5-8, drawn faintly when not selected
    expect(boxState(6)).toBe('selected')
  })

  it('opening a Review Queue card selects both and the score follows to its page', async () => {
    await open()

    fireEvent.click(card(41))

    expect(selectedBars()).toEqual([41])
    expect(selectedLocators()).toEqual(['41:0'])
    expect(pageLabel()).toBe(strings.score.pageLabel(3, 4, '33', '48'))
    expect(scroller().scrollTop).toBeGreaterThan(2000)
  })
})

describe('Practice and Edit keep the bar', () => {
  it('opens on the bar named by ?bar=: selected, its locator picked and the score scrolled to it', async () => {
    const { map } = await open('&bar=41')

    expect(selectedBars()).toEqual([41])
    expect(selectedLocators()).toEqual(['41:0'])
    expect(pageLabel()).toBe(strings.score.pageLabel(3, 4, '33', '48'))
    const box = map.pages[0].bars.find((candidate) => candidate.bar === 41)!
    expect(scroller().scrollTop).toBeCloseTo(100 + 2000 + box.y + box.h / 2 - 200, 0)
  })

  it('ignores a ?bar= that is not a bar of the part', async () => {
    await open('&bar=999')

    expect(selectedBars()).toEqual([])
    expect(pageLabel()).toBe(strings.score.pageLabel(1, 4, '1', '16'))
  })

  it('ignores a ?bar= that is not a number', async () => {
    await open('&bar=abc')

    expect(selectedBars()).toEqual([])
  })

  it('gives Practice the selected bar, else the first bar in view, and never writes the bar to the address', async () => {
    const { part, router, partId } = await open()
    expect(practice()).toHaveAttribute('href', `/pieces/${CLARK}/practice?part=${partId}&bar=1`)

    clickBar(part, 6)

    expect(practice()).toHaveAttribute('href', `/pieces/${CLARK}/practice?part=${partId}&bar=6`)
    expect(router.state.location.search).toBe(`?part=${partId}`)
  })

  it('gives Practice the bar of a locator selected on the waveform', async () => {
    const { partId } = await open()

    fireEvent.click(card(41))

    expect(practice()).toHaveAttribute('href', `/pieces/${CLARK}/practice?part=${partId}&bar=41`)
  })
})

describe('the keys of the Editor (the strip under the waveform is gone)', () => {
  it('each one still does what it says', async () => {
    const { user } = await open()
    expect(document.querySelector('[data-slot="dock-shortcuts"]')).toBeNull()

    await user.keyboard('b')
    expect(screen.getByRole('button', { name: strings.editor.modes.add })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('x')
    expect(screen.getByRole('button', { name: strings.editor.modes.delete })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('=')
    expect(screen.getByText('110%')).toBeInTheDocument()
    await user.keyboard('{Shift>}{+}{/Shift}')
    expect(stage().dataset.viewSpan).toBe('8')
    await user.keyboard('n')
    expect(within(screen.getByRole('list', { name: strings.review.queue.list })).getAllByRole('button', { expanded: true })).toHaveLength(1)
    await user.keyboard('l')
    expect(screen.getByRole('button', { name: dock.addLocator })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: dock.addLocator })).toHaveAttribute('aria-pressed', 'false')
    await user.keyboard(' ')
    expect(await screen.findByRole('button', { name: dock.pause })).toBeInTheDocument()
  })

  it('undoes with Ctrl+Z', async () => {
    const { part, user } = await open()
    clickBar(part, 5)
    fireEvent.keyDown(window, { key: 'Delete', shiftKey: true })
    clickBar(part, 6)
    expect(boxState(5)).toBe('unmatched')

    await user.keyboard('{Control>}z{/Control}')

    expect(boxState(5)).toBe('rest') // the clarinet rests in bars 5-8, drawn faintly when not selected
  })
})

describe('the arrow keys on the score', () => {
  it('move the selection to the next and previous bar, and the waveform follows', async () => {
    const { part } = await open()
    clickBar(part, 5)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(selectedBars()).toEqual([6])
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(selectedBars()).toEqual([6])
    expect(selectedLocators()).toEqual(['6:0'])
  })

  it('move to the line below and above', async () => {
    const { part } = await open()
    const from = clickBar(part, 2)

    fireEvent.keyDown(window, { key: 'ArrowDown' })

    const [below] = selectedBars()
    const box = part.bars.find((candidate) => candidate.bar === below)!
    expect(box.y).toBeGreaterThan(from.y + from.h / 2)
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(selectedBars()).toEqual([2])
  })

  it('start on the first bar when nothing is selected', async () => {
    const { part } = await open()

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(selectedBars()).toEqual([part.bars[0].bar])
  })

  it('leave a text field its own arrows, and do nothing with a modifier held', async () => {
    const { part } = await open()
    clickBar(part, 5)
    const field = document.createElement('input')
    document.body.append(field)

    fireEvent.keyDown(field, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true })

    expect(selectedBars()).toEqual([5])
    field.remove()
  })
})
