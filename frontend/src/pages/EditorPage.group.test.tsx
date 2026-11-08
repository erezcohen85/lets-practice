import { selectedLocators } from '@/test/dockSelection'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { type Locator, type TimingLayer } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// Several locators at once (UX part 5) in the real Editor on the demo piece: Shift + click chooses them, the score shows
// them, dragging one moves them all as one undo step, Snap sends each to its own beat, Esc clears.

const CLARK = 'piece-clark-county'
const dock = strings.dock
const PAGE_WIDTH = 1240
const COLUMN = PAGE_WIDTH + 2 * 16
const STAGE_WIDTH = 1000

async function open(prepare?: (fakes: Fakes) => void) {
  const fakes = createFakes({ seed: 'demo' })
  prepare?.(fakes)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const map = (await fakes.data.getPieceMap(CLARK))!
  const view = renderWithApp(`/pieces/${CLARK}/edit`, { fakes, playerSec: 271 })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  await screen.findByRole('timer', { name: dock.timeLabel })
  return { ...view, fakes, part: map.pages[0] }
}

const pageEl = (index: number) => {
  const el = document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAGE_WIDTH, height: 1754, right: PAGE_WIDTH, bottom: 1754, x: 0, y: 0, toJSON() {} })
  return el
}
/** A click on a bar of the score, which selects its locator and brings it into the dock's window. */
function clickBar(part: { bars: { bar: number; pageIndex: number; x: number; y: number; w: number; h: number }[] }, bar: number) {
  const box = part.bars.find((candidate) => candidate.bar === bar)!
  fireEvent.pointerDown(pageEl(box.pageIndex), { clientX: box.x + box.w / 2, clientY: box.y + 50 })
  fireEvent.pointerUp(pageEl(box.pageIndex), { clientX: box.x + box.w / 2, clientY: box.y + 50 })
}

const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
const selectedBars = () => [...document.querySelectorAll('[data-slot="bar-box"][data-state="selected"]')].map((el) => Number(el.getAttribute('data-bar')))
const movedBars = () => [...document.querySelectorAll('[data-slot="bar-box"][data-state="moved"]')].map((el) => Number(el.getAttribute('data-bar')))
const timingOf = (fakes: Fakes): TimingLayer => fakes.store.maps.get(CLARK)!.timing
const timeOf = (fakes: Fakes, bar: number, passIndex = 0) => timingOf(fakes).locators.find((l: Locator) => l.bar === bar && l.passIndex === passIndex)!.timeSec
const undoButton = () => within(screen.getByRole('region', { name: strings.editor.sheet })).getByRole('button', { name: new RegExp(`^(${strings.history.undo}|${strings.history.nothingToUndo})`) })

function dockX(timeSec: number) {
  const start = Number(stage().dataset.viewStart)
  const span = Number(stage().dataset.viewSpan)
  stage().getBoundingClientRect = () => ({ left: 0, top: 0, width: STAGE_WIDTH, height: 150, right: STAGE_WIDTH, bottom: 150, x: 0, y: 0, toJSON() {} })
  return ((timeSec - start) / span) * STAGE_WIDTH
}
const inWindow = (timeSec: number) => {
  const start = Number(stage().dataset.viewStart)
  return timeSec >= start && timeSec <= start + Number(stage().dataset.viewSpan)
}
function press(timeSec: number, shiftKey = false) {
  const x = dockX(timeSec)
  fireEvent.pointerDown(stage(), { clientX: x, clientY: 60, shiftKey })
  fireEvent.pointerUp(stage(), { clientX: x, clientY: 60, shiftKey })
}

/** Bar 3 is clicked on the score to bring the window to it, then bar 2 is pressed on the dock and bars 3 and 4 are Shift + pressed. */
async function chooseThree(fakes: Fakes, part: Parameters<typeof clickBar>[0]) {
  clickBar(part, 3)
  await waitFor(() => expect(inWindow(timeOf(fakes, 4))).toBe(true))
  press(timeOf(fakes, 2))
  press(timeOf(fakes, 3), true)
  press(timeOf(fakes, 4), true)
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('choosing several locators in the Editor', () => {
  it('shows every chosen bar on the score and says how many are chosen', async () => {
    const { fakes, part } = await open()
    await chooseThree(fakes, part)
    expect(selectedBars()).toEqual([2, 3, 4])
    expect(selectedLocators()).toEqual(['2:0', '3:0', '4:0'])
  })

  it('Escape clears the selection on the waveform and on the score', async () => {
    const { fakes, part, user } = await open()
    await chooseThree(fakes, part)
    await user.keyboard('{Escape}')
    expect(selectedBars()).toEqual([])
    expect(selectedLocators()).toEqual([])
  })

  it('a plain click on one of the lines goes back to that one bar', async () => {
    const { fakes, part } = await open()
    await chooseThree(fakes, part)
    press(timeOf(fakes, 3))
    expect(selectedBars()).toEqual([3])
  })
})

describe('moving several locators in the Editor', () => {
  it('dragging one moves them all by the same offset, as one undo step', async () => {
    const { fakes, part, user } = await open()
    const before = [2, 3, 4].map((bar) => timeOf(fakes, bar))
    await chooseThree(fakes, part)

    const from = dockX(before[1])
    fireEvent.pointerDown(stage(), { clientX: from, clientY: 60 })
    fireEvent.pointerMove(stage(), { clientX: from + 30, clientY: 60, shiftKey: true })
    fireEvent.pointerMove(stage(), { clientX: from + 60, clientY: 60, shiftKey: true })
    fireEvent.pointerUp(stage(), { clientX: from + 60, clientY: 60, shiftKey: true })

    await waitFor(() => expect(timeOf(fakes, 3)).not.toBe(before[1]))
    const delta = timeOf(fakes, 3) - before[1]
    expect(delta).toBeGreaterThan(0)
    expect(timeOf(fakes, 2) - before[0]).toBeCloseTo(delta, 6)
    expect(timeOf(fakes, 4) - before[2]).toBeCloseTo(delta, 6)
    expect(timingOf(fakes).locators.filter((l: Locator) => [2, 3, 4].includes(l.bar) && l.passIndex === 0).every((l: Locator) => l.confirmed)).toBe(true)
    // A moved bar keeps its moved tint while chosen; all three are still chosen on the waveform.
    expect(movedBars()).toEqual([2, 3, 4])
    expect(selectedLocators()).toEqual(['2:0', '3:0', '4:0'])

    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: move 3 locators`)
    await user.click(undoButton())
    await waitFor(() => expect(timeOf(fakes, 3)).toBe(before[1]))
    expect(timeOf(fakes, 2)).toBe(before[0])
    expect(timeOf(fakes, 4)).toBe(before[2])
  })

  it('Snap sends each to its own next beat and says how many moved', async () => {
    const { fakes, part, user } = await open()
    const before = [2, 3, 4].map((bar) => timeOf(fakes, bar))
    await chooseThree(fakes, part)

    await user.keyboard('.')

    await waitFor(() => expect(timeOf(fakes, 2)).toBeGreaterThan(before[0]))
    expect(timeOf(fakes, 3)).toBeGreaterThan(before[1])
    expect(timeOf(fakes, 4)).toBeGreaterThan(before[2])
    expect(await screen.findByText(dock.snapDone(3, 0))).toBeInTheDocument()
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: move 3 locators`)
  })

  it('Snap to closest sends each to the beat beside it, either way, and says how many moved', async () => {
    const offsets = new Map([[2, 0.05], [3, -0.05], [4, 0.1]])
    const { fakes, part, user } = await open((given) => {
      given.store.beats.set(CLARK, [...offsets].map(([bar, offset]) => ({ t: timeOf(given, bar) + offset, downbeat: 0.1 })))
    })
    const before = [2, 3, 4].map((bar) => timeOf(fakes, bar))
    await chooseThree(fakes, part)

    await user.keyboard('/')

    await waitFor(() => expect(timeOf(fakes, 2)).toBeCloseTo(before[0] + 0.05, 6))
    expect(timeOf(fakes, 3)).toBeCloseTo(before[1] - 0.05, 6)
    expect(timeOf(fakes, 4)).toBeCloseTo(before[2] + 0.1, 6)
    expect(await screen.findByText(dock.snapDoneClosest(3, 0))).toBeInTheDocument()
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: move 3 locators`)
  })
})
