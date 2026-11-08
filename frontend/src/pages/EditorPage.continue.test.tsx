import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { type Locator, type TimingLayer } from '@/domain/types'
import { DEFAULT_SETTINGS, type ContinueMode } from '@/lib/dataClient'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// Continue from my bars in the real Editor on the demo piece, with the fakes: the Settings choice decides whether the Editor
// asks, leaves it to the toolbar's button, or puts the bar lines on the beats by itself once the fourth line is checked.

const CLARK = 'piece-clark-county'
const dock = strings.dock
const g = dock.grid
const PAGE_WIDTH = 1240
const COLUMN = PAGE_WIDTH + 2 * 16
const STAGE_WIDTH = 1000
/** The demo piece plays 72 bars: bars 1 to 16, 9 to 16 again, 17 to 64. */
const SLOTS = 72

/**
 * The recording has a beat every half second from 1 s. Bars 1 to `checked` are checked, 4 beats apart (1, 3, 5, 7 s); bar `checked + 1` on
 * and the rest of bars 1 to 12 are guesses off the beats, 1.1 s apart.
 */
function lines(checked: number): (fakes: Fakes) => void {
  return (fakes) => {
    fakes.store.beats.set(
      CLARK,
      Array.from({ length: 200 }, (_, i) => ({ t: 1 + 0.5 * i, downbeat: i % 4 === 0 ? 0.9 : 0.1 })),
    )
    const map = fakes.store.maps.get(CLARK)!
    const found: Locator[] = Array.from({ length: 12 }, (_, i) => ({
      bar: i + 1,
      passIndex: 0,
      timeSec: i < checked ? 1 + 2 * i : 1 + 2 * (checked - 1) + 0.3 + 1.1 * (i - checked + 1),
      confirmed: i < checked,
    }))
    map.timing = { ...map.timing, locators: found }
  }
}

async function open(checked: number, continueMode?: ContinueMode) {
  const fakes = createFakes({ seed: 'demo' })
  lines(checked)(fakes)
  if (continueMode !== undefined) await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, continueMode })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const view = renderWithApp(`/pieces/${CLARK}/edit`, { fakes, playerSec: 271 })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  await screen.findByRole('timer', { name: dock.timeLabel })
  // The Editor fills the bars that have no line when it opens (one step of its own): wait for it.
  await waitFor(() => expect(timesOf(fakes)).toHaveLength(SLOTS))
  return { ...view, fakes }
}

const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
const timingOf = (fakes: Fakes): TimingLayer => fakes.store.maps.get(CLARK)!.timing
const timesOf = (fakes: Fakes): number[] => timingOf(fakes).locators.map((l) => l.timeSec)
const undoButton = () => within(screen.getByRole('region', { name: strings.editor.sheet })).getByRole('button', { name: new RegExp(`^(${strings.history.undo}|${strings.history.nothingToUndo})`) })
const redoButton = () => within(screen.getByRole('region', { name: strings.editor.sheet })).getByRole('button', { name: new RegExp(`^(${strings.history.redo}|${strings.history.nothingToRedo})`) })
const prompt = () => screen.queryByRole('status', { name: g.promptRegion })
const promptButton = (name: string) => within(screen.getByRole('status', { name: g.promptRegion })).getByRole('button', { name })

function dockX(timeSec: number) {
  const start = Number(stage().dataset.viewStart)
  const span = Number(stage().dataset.viewSpan)
  stage().getBoundingClientRect = () => ({ left: 0, top: 0, width: STAGE_WIDTH, height: 150, right: STAGE_WIDTH, bottom: 150, x: 0, y: 0, toJSON() {} })
  return ((timeSec - start) / span) * STAGE_WIDTH
}
/** Drags the locator line at `fromSec` on the dock to `fromSec + deltaSec`: press, move, release. */
function dragOnDock(fromSec: number, deltaSec: number) {
  const x = dockX(fromSec)
  fireEvent.pointerDown(stage(), { clientX: x, clientY: 60 })
  fireEvent.pointerMove(stage(), { clientX: dockX(fromSec + deltaSec / 2), clientY: 60 })
  fireEvent.pointerMove(stage(), { clientX: dockX(fromSec + deltaSec), clientY: 60 })
  fireEvent.pointerUp(stage(), { clientX: dockX(fromSec + deltaSec), clientY: 60 })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Continue from my bars in the Editor', () => {
  it('asks by default once 4 lines in a row are checked; Continue puts the lines on the beats as the toolbar does, and Undo restores them', async () => {
    const { fakes, user } = await open(4)
    const before = timesOf(fakes)

    expect(await screen.findByRole('status', { name: g.promptRegion })).toHaveTextContent(/^Your bars 1 to 4 hold 4 beats each\. Continue that pattern to bar \d+\?/)
    await user.click(promptButton(g.promptContinue))

    await waitFor(() => expect(timesOf(fakes).slice(3, 8)).toEqual([7, 9, 11, 13, 15]))
    expect(timingOf(fakes).locators.slice(0, 4).every((l) => l.confirmed)).toBe(true)
    expect(timingOf(fakes).locators.slice(4).every((l) => !l.confirmed)).toBe(true)
    expect(await screen.findByText(/^Continued from your bars 1 to 4: \d+ bar lines placed on the beats\.$/)).toBeInTheDocument()
    expect(prompt()).not.toBeInTheDocument()
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: put bar lines on the beats`)

    await user.click(undoButton())

    await waitFor(() => expect(timesOf(fakes)).toEqual(before))
    // it was answered: Undo does not bring the question back
    expect(prompt()).not.toBeInTheDocument()
  })

  it('Not now changes nothing and the question stays away', async () => {
    const { fakes, user } = await open(4)
    const before = timesOf(fakes)
    await screen.findByRole('status', { name: g.promptRegion })

    await user.click(promptButton(g.promptNotNow))

    expect(prompt()).not.toBeInTheDocument()
    expect(timesOf(fakes)).toEqual(before)
    // the toolbar's Continue is still there for it
    expect(within(screen.getByRole('group', { name: g.group })).getByRole('button', { name: g.continue })).not.toHaveAttribute('aria-disabled')
  })

  it('asks for nothing with fewer than 4 checked lines in a row', async () => {
    await open(3)

    expect(prompt()).not.toBeInTheDocument()
  })

  it('Button only: no question, and nothing by itself', async () => {
    const { fakes } = await open(4, 'button')
    const before = timesOf(fakes)

    expect(prompt()).not.toBeInTheDocument()
    expect(timesOf(fakes)).toEqual(before)
    expect(within(screen.getByRole('group', { name: g.group })).getByRole('button', { name: g.continue })).not.toHaveAttribute('aria-disabled')
  })

  it('Automatically: nothing when the Editor opens, then the lines go on the beats at once when the fourth line is checked, with the message and one Undo', async () => {
    const { fakes, user } = await open(3, 'auto')
    // bar 4 is a guess a little after its beat; dragging it onto the beat checks it
    const bar4 = timingOf(fakes).locators.find((l) => l.bar === 4 && l.passIndex === 0)!
    expect(bar4.confirmed).toBe(false)
    const before = timesOf(fakes)
    expect(prompt()).not.toBeInTheDocument()

    dragOnDock(bar4.timeSec, 7 - bar4.timeSec)

    await waitFor(() => expect(timesOf(fakes).slice(3, 8)).toEqual([7, 9, 11, 13, 15]))
    expect(prompt()).not.toBeInTheDocument()
    expect(await screen.findByText(/^Continued from your bars 1 to 4: \d+ bar lines placed on the beats\.$/)).toBeInTheDocument()
    expect(timingOf(fakes).locators.slice(0, 4).every((l) => l.confirmed)).toBe(true)
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: put bar lines on the beats`)

    // Undo takes the lines off the beats again, and it does not come back by itself
    await user.click(undoButton())
    await waitFor(() => expect(timesOf(fakes).slice(4, 8)).not.toEqual([9, 11, 13, 15]))
    expect(timesOf(fakes).slice(0, 3)).toEqual(before.slice(0, 3))
    expect(timesOf(fakes)[3]).toBe(7)
    expect(timesOf(fakes).slice(4, 8)).toEqual(before.slice(4, 8))
  })

  it('Automatically: Undo back past the check of the next bar does not start Continue from the bars that were waiting, and Redo stays', async () => {
    const { fakes, user } = await open(4, 'auto')
    const before = timesOf(fakes)
    const bar5 = timingOf(fakes).locators.find((l) => l.bar === 5 && l.passIndex === 0)!
    expect(bar5.confirmed).toBe(false)

    // bar 5 is checked by dragging it onto its beat: Continue goes on from bars 2 to 5
    dragOnDock(bar5.timeSec, 9 - bar5.timeSec)
    await waitFor(() => expect(timesOf(fakes).slice(4, 8)).toEqual([9, 11, 13, 15]))
    expect(await screen.findByText(/^Continued from your bars 2 to 5: /)).toBeInTheDocument()

    // Undo of the Continue, then Undo of the check: the run of bars 1 to 4 that was waiting is back, and nothing is done for it
    await user.click(undoButton())
    await waitFor(() => expect(timesOf(fakes)[4]).toBe(9))
    expect(timesOf(fakes).slice(5, 8)).toEqual(before.slice(5, 8))
    await user.click(undoButton())
    await waitFor(() => expect(timesOf(fakes)).toEqual(before))
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(timesOf(fakes)).toEqual(before)
    expect(prompt()).not.toBeInTheDocument()
    // an edit by itself would have wiped what can be redone
    expect(redoButton()).toHaveAccessibleName(new RegExp(`^${strings.history.redo}: `))
  })

  it('Automatically: nothing by itself when the Editor opens on 4 checked lines', async () => {
    const { fakes } = await open(4, 'auto')
    const before = timesOf(fakes)

    // give the page a moment: an automatic Continue would be an edit that lands at once
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(timesOf(fakes)).toEqual(before)
    expect(prompt()).not.toBeInTheDocument()
    expect(undoButton()).toHaveAccessibleName(new RegExp(`^${strings.history.undo}`))
    expect(undoButton().getAttribute('aria-label') ?? undoButton().textContent).not.toMatch(/put bar lines on the beats/)
  })
})
