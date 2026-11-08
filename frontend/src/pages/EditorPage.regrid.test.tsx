import { selectedLocators } from '@/test/dockSelection'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { type Locator, type TimingLayer } from '@/domain/types'
import { hintOf } from '@/components/ui/hint'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// Bar lines on the beats (the group after Snap in the dock) in the real Editor on the demo piece, with the fakes: the
// buttons put the lines on the beats as one undo step, say what they did, and ask before changing the whole piece.

const CLARK = 'piece-clark-county'
const dock = strings.dock
const g = dock.grid
const PAGE_WIDTH = 1240
const COLUMN = PAGE_WIDTH + 2 * 16
const STAGE_WIDTH = 1000
const BEAT_SEC = 0.5
/** The demo piece plays 72 bars: bars 1 to 16, 9 to 16 again, 17 to 64. */
const SLOTS = 72

/** The recording has a beat every half second from 1 s. Bars 1 to 12 are lines on every 4th beat (1, 3, ... 23 s), the others have none; `checked` bars are confirmed. */
function pulse(checked: readonly number[] = [], extra: Locator[] = []) {
  return (fakes: Fakes) => {
    fakes.store.beats.set(
      CLARK,
      Array.from({ length: 200 }, (_, i) => ({ t: 1 + BEAT_SEC * i, downbeat: i % 4 === 0 ? 0.9 : 0.1 })),
    )
    const map = fakes.store.maps.get(CLARK)!
    const lines: Locator[] = Array.from({ length: 12 }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 1 + 2 * i, confirmed: checked.includes(i + 1) }))
    map.timing = { ...map.timing, locators: [...lines.filter((l) => extra.every((e) => e.bar !== l.bar)), ...extra].sort((a, b) => a.bar - b.bar) }
  }
}

async function open(prepare: (fakes: Fakes) => void) {
  const fakes = createFakes({ seed: 'demo' })
  prepare(fakes)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const view = renderWithApp(`/pieces/${CLARK}/edit`, { fakes, playerSec: 271 })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  await screen.findByRole('timer', { name: dock.timeLabel })
  // The Editor fills the bars that have no line when it opens (one step of its own): wait for it, so every test starts from the full map.
  await waitFor(() => expect(timesOf(fakes)).toHaveLength(SLOTS))
  return { ...view, fakes }
}

const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
const timingOf = (fakes: Fakes): TimingLayer => fakes.store.maps.get(CLARK)!.timing
const timesOf = (fakes: Fakes): number[] => timingOf(fakes).locators.map((l) => l.timeSec)
const undoButton = () => within(screen.getByRole('region', { name: strings.editor.sheet })).getByRole('button', { name: new RegExp(`^(${strings.history.undo}|${strings.history.nothingToUndo})`) })
const button = (name: string) => screen.getByRole('button', { name })
// the Ask me panel has a Continue of its own when a run of checked bars is waiting: the toolbar's is the one in its group
const toolbarContinue = () => within(screen.getByRole('group', { name: g.group })).getByRole('button', { name: g.continue })

function dockX(timeSec: number) {
  const start = Number(stage().dataset.viewStart)
  const span = Number(stage().dataset.viewSpan)
  stage().getBoundingClientRect = () => ({ left: 0, top: 0, width: STAGE_WIDTH, height: 150, right: STAGE_WIDTH, bottom: 150, x: 0, y: 0, toJSON() {} })
  return ((timeSec - start) / span) * STAGE_WIDTH
}
function press(timeSec: number, shiftKey = false) {
  const x = dockX(timeSec)
  fireEvent.pointerDown(stage(), { clientX: x, clientY: 60, shiftKey })
  fireEvent.pointerUp(stage(), { clientX: x, clientY: 60, shiftKey })
}
/** The first and the fourth line (1 s and 7 s) are chosen on the waveform. */
function chooseBars1To4() {
  press(1)
  press(7, true)
  expect(selectedLocators()).toEqual(['1:0', '4:0'])
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('bar lines on the beats in the Editor', () => {
  it('Double-time over two chosen lines puts lines on the beats between them, says how many, and Undo restores them in one step', async () => {
    const { fakes, user } = await open(pulse())
    const before = timesOf(fakes)
    chooseBars1To4()

    await user.click(button(g.doubleTime))

    // 4 beats a bar became 2: new lines at 2, 4 and 6 s, and the later bars move up three places. Every bar of the piece had a line,
    // so the last three are pushed off the end.
    await waitFor(() => expect(timesOf(fakes).slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 9]))
    expect(timesOf(fakes)).toHaveLength(SLOTS)
    expect(await screen.findByText(g.done(3, 0, 3))).toBeInTheDocument()
    expect(g.done(3, 0, 3)).toBe('3 bar lines placed on the beats. 3 later bar lines dropped past the last bar.')
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: put bar lines on the beats`)

    await user.click(undoButton())

    await waitFor(() => expect(timesOf(fakes)).toEqual(before))
  })

  it('keeps both chosen lines chosen, on the same lines of the recording, after Double-time moved the later bars up', async () => {
    const { fakes, user } = await open(pulse())
    chooseBars1To4()

    await user.click(button(g.doubleTime))

    // 3 lines were added between them, so the line at 7 s is bar 7 now; the line at 1 s is still bar 1
    await waitFor(() => expect(timesOf(fakes).slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 9]))
    expect(timingOf(fakes).locators.find((l) => l.timeSec === 7)).toMatchObject({ bar: 7, passIndex: 0 })
    expect(selectedLocators()).toEqual(['1:0', '7:0'])
    // and the toolbar still works on the two lines it holds: 2 beats a bar now, so Double-time has 1 left to go to
    expect(button(g.beatsABar(2))).toHaveAttribute('aria-pressed', 'true')
  })

  it('a segment puts the lines on every 2nd beat, and the pressed one follows the lines', async () => {
    const { fakes, user } = await open(pulse())
    chooseBars1To4()
    expect(button(g.beatsABar(4))).toHaveAttribute('aria-pressed', 'true')

    await user.click(button(g.beatsABar(2)))

    await waitFor(() => expect(timesOf(fakes).slice(0, 4)).toEqual([1, 2, 3, 4]))
    expect(button(g.beatsABar(2))).toHaveAttribute('aria-pressed', 'true')
    expect(button(g.beatsABar(2))).toHaveAttribute('aria-disabled', 'true')
  })

  it('with nothing selected it asks first; Cancel changes nothing, and confirming changes the whole piece as one step', async () => {
    const { fakes, user } = await open(pulse())
    await user.keyboard('{Escape}')
    expect(selectedLocators()).toEqual([])
    const before = timesOf(fakes)

    await user.click(button(g.doubleTime))
    const question = await screen.findByRole('alertdialog')
    expect(within(question).getByText(g.wholeTitle)).toBeInTheDocument()
    await user.click(within(question).getByRole('button', { name: g.wholeCancel }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(timesOf(fakes)).toEqual(before)
    expect(undoButton()).not.toHaveAccessibleName(/put bar lines on the beats/)

    await user.click(button(g.doubleTime))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: g.wholeConfirm }))

    // The opening fill had put lines 2 s apart up to 113 s (4/4: 4 beats a bar) and 1 s apart after (the 2/4 bars from bar 49).
    // Double-time is 2 beats a bar of 4/4, so a line every second from 1 s, and the 16 bars of 2/4 take half of that: a line every
    // half second from 57 s. That is 40 new lines between the old ones, and the 40 old lines past 63 s are removed.
    const doubled = (i: number) => (i <= 56 ? i + 1 : 57 + (i - 56) / 2)
    await waitFor(() => expect(timesOf(fakes)).toEqual(Array.from({ length: SLOTS }, (_, i) => doubled(i))))
    expect(await screen.findByText(g.done(40, 40, 0))).toBeInTheDocument()
    expect(g.done(40, 40, 0)).toBe('40 bar lines placed on the beats. 40 removed.')
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: put bar lines on the beats`)

    await user.click(undoButton())

    await waitFor(() => expect(timesOf(fakes)).toEqual(before))
  })

  it('Continue goes on from the checked bars and says which bars it learned from', async () => {
    // bars 1 to 4 are checked on every 4th beat; the guesses after them are 1 s apart, the other pulse
    const guesses: Locator[] = Array.from({ length: 8 }, (_, i) => ({ bar: 5 + i, passIndex: 0, timeSec: 8 + i, confirmed: false }))
    const { fakes, user } = await open(pulse([1, 2, 3, 4], guesses))
    await user.keyboard('{Escape}')
    const before = timesOf(fakes)

    await user.click(toolbarContinue())

    await waitFor(() => expect(timesOf(fakes).slice(3, 8)).toEqual([7, 9, 11, 13, 15]))
    expect(timingOf(fakes).locators.slice(0, 4).every((l) => l.confirmed)).toBe(true)
    expect(timingOf(fakes).locators.slice(4).every((l) => !l.confirmed)).toBe(true)
    expect(await screen.findByText(/^Continued from your bars 1 to 4: \d+ bar lines placed on the beats\.$/)).toBeInTheDocument()
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: put bar lines on the beats`)

    await user.click(undoButton())

    await waitFor(() => expect(timesOf(fakes)).toEqual(before))
  })

  it('a segment pressed with the keyboard keeps the focus when it becomes the pressed one, and the group can be tabbed into again', async () => {
    const { fakes, user } = await open(pulse())
    chooseBars1To4()
    const segments = () => within(screen.getByRole('group', { name: g.beatsABarWord })).getAllByRole('button')
    button(g.doubleTime).focus()

    await user.tab()
    expect(button(g.beatsABar(1))).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(button(g.beatsABar(2))).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(timesOf(fakes).slice(0, 4)).toEqual([1, 2, 3, 4]))
    // 2 beats a bar is what the stretch has now: pressed, off, and still holding the focus
    await waitFor(() => expect(button(g.beatsABar(2))).toHaveAttribute('aria-disabled', 'true'))
    expect(button(g.beatsABar(2))).toHaveAttribute('aria-pressed', 'true')
    expect(button(g.beatsABar(2))).toHaveFocus()

    await user.tab()
    expect(segments()).not.toContain(document.activeElement)
    await user.tab({ shift: true })
    expect(segments()).toContain(document.activeElement)
  })

  it('Double-time keeps the focus when it turns itself off by being pressed down to 1 beat a bar', async () => {
    const { fakes, user } = await open(pulse())
    chooseBars1To4()
    button(g.doubleTime).focus()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(timesOf(fakes).slice(0, 4)).toEqual([1, 2, 3, 4]))
    expect(button(g.doubleTime)).toHaveFocus()
    expect(button(g.doubleTime)).not.toHaveAttribute('aria-disabled')

    await user.keyboard('{Enter}')
    await waitFor(() => expect(timesOf(fakes).slice(0, 4)).toEqual([1, 1.5, 2, 2.5]))
    // 1 beat a bar: Double-time is off now, and still holds the focus
    await waitFor(() => expect(button(g.doubleTime)).toHaveAttribute('aria-disabled', 'true'))
    expect(button(g.doubleTime)).not.toBeDisabled()
    expect(button(g.doubleTime)).toHaveFocus()
    expect(button(g.beatsABar(1))).toHaveAttribute('aria-pressed', 'true')
  })

  it('Continue keeps the focus when it turns itself off by going on', async () => {
    const guesses: Locator[] = Array.from({ length: 8 }, (_, i) => ({ bar: 5 + i, passIndex: 0, timeSec: 8 + i, confirmed: false }))
    const { fakes, user } = await open(pulse([1, 2, 3, 4], guesses))
    await user.keyboard('{Escape}')
    toolbarContinue().focus()
    expect(toolbarContinue()).not.toHaveAttribute('aria-disabled')

    await user.keyboard('{Enter}')

    await waitFor(() => expect(timesOf(fakes).slice(3, 8)).toEqual([7, 9, 11, 13, 15]))
    await waitFor(() => expect(toolbarContinue()).toHaveAttribute('aria-disabled', 'true'))
    expect(toolbarContinue()).toHaveFocus()
  })

  it('works from the Beats menu too, and Undo restores in one step', async () => {
    const { fakes, user } = await open(pulse())
    const before = timesOf(fakes)
    chooseBars1To4()

    await user.click(screen.getByRole('button', { name: g.beatsMenu }))
    await user.click(await screen.findByRole('menuitem', { name: g.doubleTime }))

    await waitFor(() => expect(timesOf(fakes).slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 9]))
    expect(await screen.findByText(g.done(3, 0, 3))).toBeInTheDocument()
    await user.click(undoButton())
    await waitFor(() => expect(timesOf(fakes)).toEqual(before))
  })

  it('says in its hover text why a control is off', async () => {
    await open(pulse())
    chooseBars1To4()

    expect(button(g.halfTime)).toHaveAttribute('aria-disabled', 'true')
    expect(hintOf(button(g.halfTime))).toBe(g.halfTimeTooMany(4))
    expect(toolbarContinue()).toHaveAttribute('aria-disabled', 'true')
    expect(hintOf(toolbarContinue())).toBe(g.nothingToLearn)
  })
})
