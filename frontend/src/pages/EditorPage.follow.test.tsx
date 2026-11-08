import { selectedLocators } from '@/test/dockSelection'
import { confirmPieceChange, turnOnPieceEditing } from '@/test/pieceChange'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { buildTimeline, slotIndexAt } from '@/domain/tempo'
import { type TimingLayer } from '@/domain/types'
import { DEFAULT_SETTINGS, type FollowSettings } from '@/lib/dataClient'
import { createFakes, type Fakes } from '@/lib/fakes'
import { type FakePlayer } from '@/lib/fakes/fakePlayer'
import { LINE_AT } from '@/components/practice/useFollowScroll'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// The Editor's score follows the playback and a bar click moves the playhead (task 6.10): the follow box shows the bar
// under the playhead, moving bar to bar while playing, the score scrolls to it only while playing, and a click on a
// bar of the score seeks to that bar's locator.

const CLARK = 'piece-clark-county'
const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
const COLUMN = PAGE_WIDTH + 2 * 16
const pageTop = (pageIndex: number) => 100 + 1000 * pageIndex
const dock = strings.dock
const text = strings.editor

async function open(follow: Partial<FollowSettings> = {}) {
  const fakes: Fakes = createFakes({ seed: 'demo' })
  // The fill of empty bars is off (the processor cannot fit them): the Realign test below walks the Realign that follows an edit.
  vi.spyOn(fakes.processor, 'fillEmptyBars').mockResolvedValue(null)
  await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, follow: { ...DEFAULT_SETTINGS.follow, ...follow } })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return pageTop(Number(this.dataset.pageIndex ?? 0))
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900)
  const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = options.top ?? 0
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })

  const detail = (await fakes.data.getPiece(CLARK))!
  const map = (await fakes.data.getPieceMap(CLARK))!
  let player: FakePlayer | undefined
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${detail.parts[0].id}`, { fakes, playerSec: 271, onMedia: (made) => (player = made.player ?? player) })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  await screen.findByRole('timer', { name: dock.timeLabel })
  const timeline = buildTimeline(map.timing, 271)
  return { ...view, fakes, map, part: map.pages[0], timeline, scrollTo, player: () => player! }
}

type Opened = Awaited<ReturnType<typeof open>>

const pageEl = (index: number) => {
  const el = document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, right: PAGE_WIDTH, bottom: PAGE_HEIGHT, x: 0, y: 0, toJSON() {} })
  return el
}
function clickBar({ part }: Opened, bar: number) {
  const box = part.bars.find((candidate) => candidate.bar === bar)!
  const x = box.x + box.w / 2
  const y = box.y + 50
  fireEvent.pointerDown(pageEl(box.pageIndex), { clientX: x, clientY: y })
  fireEvent.pointerUp(pageEl(box.pageIndex), { clientX: x, clientY: y })
}
/** The playhead to the middle of the nth bar played. */
const seekToPosition = (view: Opened, position: number) => {
  const { startSec, endSec } = view.timeline[position]
  act(() => view.player().seek((startSec + endSec) / 2))
}
const play = () => fireEvent.click(screen.getByRole('button', { name: dock.play }))
const followBars = () => [...document.querySelectorAll('[data-slot="follow-box"]')].map((el) => Number(el.getAttribute('data-bar')))
const selectedBars = () => [...document.querySelectorAll('[data-slot="bar-box"][data-state="selected"]')].map((el) => Number(el.getAttribute('data-bar')))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a bar clicked on the score moves the playhead', () => {
  it('seeks to the bar\'s locator, so the waveform playhead and the follow box are there', async () => {
    const view = await open()
    const locator = view.map.timing.locators.find((l) => l.bar === 12 && l.passIndex === 0)!

    clickBar(view, 12)

    expect(view.player().getTime()).toBeCloseTo(locator.timeSec, 5)
    expect(followBars()).toEqual([12])
    expect(selectedBars()).toEqual([12])
  })

  it('seeks to the pass nearest the playhead when the bar is played more than once', async () => {
    const view = await open()
    const second = view.map.timing.locators.find((l) => l.bar === 9 && l.passIndex === 1)!
    seekToPosition(view, view.timeline.findIndex((s) => s.slot.bar === 9 && s.slot.passIndex === 1))

    clickBar(view, 9)

    expect(selectedLocators()).toEqual(['9:1'])
    expect(view.player().getTime()).toBeCloseTo(second.timeSec, 5)
  })

  it('keeps playing from the new place, and keeps paused where it was paused', async () => {
    const view = await open()
    clickBar(view, 5)
    expect(view.player().isPlaying()).toBe(false)

    play()
    await waitFor(() => expect(view.player().isPlaying()).toBe(true))
    clickBar(view, 12)

    expect(view.player().isPlaying()).toBe(true)
    expect(view.player().getTime()).toBeGreaterThanOrEqual(view.map.timing.locators.find((l) => l.bar === 12)!.timeSec)
  })

  it('selects a bar with no locator and leaves the playhead where it is', async () => {
    const view = await open()
    clickBar(view, 5)
    fireEvent.keyDown(window, { key: 'Delete', shiftKey: true })
    clickBar(view, 12)
    const before = view.player().getTime()

    clickBar(view, 5)

    expect(selectedBars()).toEqual([5])
    expect(view.player().getTime()).toBe(before)
  })

  it('does not move the playhead for a click in Add bar line mode', async () => {
    const view = await open()
    clickBar(view, 12)
    const before = view.player().getTime()
    fireEvent.keyDown(window, { key: 'b' })

    clickBar(view, 6)

    expect(view.player().getTime()).toBe(before)
  })
})

describe('the follow box on the score', () => {
  it('stays on the playhead\'s bar while paused', async () => {
    const view = await open()

    seekToPosition(view, 20)

    expect(followBars()).toEqual([view.timeline[20].slot.bar])
  })

  it('moves from bar to bar while playing, across a line break and a page', async () => {
    const view = await open()
    const pageOf = (position: number) => view.part.bars.find((b) => b.bar === view.timeline[position].slot.bar)!.pageIndex
    // The last bar played on a page, then the first of the next (the demo repeats bars 9-16, so not the bar numbers).
    const turn = view.timeline.findIndex((_, position) => position > 0 && pageOf(position) !== pageOf(position - 1))
    const start = turn - 2
    seekToPosition(view, start)
    play()
    await waitFor(() => expect(view.player().isPlaying()).toBe(true))
    for (let step = 0; step < 4; step++) {
      const slot = view.timeline[start + step]
      act(() => view.player().seek(slot.startSec + 0.4 * (slot.endSec - slot.startSec)))
      await waitFor(() => expect(followBars()).toEqual([slot.slot.bar]))
      const page = pageOf(start + step)
      expect(document.querySelector(`[data-slot="score-page"][data-page-index="${page}"] [data-slot="follow-box"]`)).not.toBeNull()
    }

    expect(pageOf(start)).toBe(pageOf(turn - 1))
    expect(pageOf(start + 3)).not.toBe(pageOf(start))
  })

  it('draws in the follow colour, or not at all when the box is off', async () => {
    const view = await open({ box: false })
    seekToPosition(view, 20)
    expect(document.querySelector('[data-slot="follow-box"]')).toBeNull()
    expect(document.querySelector('[data-slot="follow-line"]')).not.toBeNull()
  })

  it('does not take the pointer: a click on the followed bar still reaches the bar', async () => {
    const view = await open()
    seekToPosition(view, 20)
    const bar = view.timeline[20].slot.bar
    expect(document.querySelector('[data-slot="follow-box"]')!.className).toContain('pointer-events-none')

    clickBar(view, bar)

    expect(selectedBars()).toEqual([bar])
  })

  it('is drawn inside the selected bar\'s box, so both show when the playhead is on the selected bar', async () => {
    const view = await open()
    seekToPosition(view, view.timeline.findIndex((s) => s.slot.bar === 12))

    clickBar(view, 20)

    expect(followBars()).toEqual([20])
    expect(selectedBars()).toEqual([20])

    const selection = document.querySelector<HTMLElement>('[data-slot="bar-box"][data-bar="20"]')!
    const box = document.querySelector<HTMLElement>('[data-slot="follow-box"]')!
    const target = view.part.bars.find((b) => b.bar === 20)!
    expect(selection.style.width).toBe(`${target.w}px`)
    expect(parseFloat(box.style.width)).toBeLessThan(target.w)
  })
})

describe('the score keeps the playing bar in view only while playing', () => {
  it('does not scroll by itself when paused, wherever the playhead goes', async () => {
    const view = await open()
    seekToPosition(view, 40)
    seekToPosition(view, 10)

    expect(view.scrollTo).not.toHaveBeenCalled()
  })

  it('scrolls the playing line to the top of the column once play starts, and follows to a later line', async () => {
    const view = await open()
    const position = 40
    seekToPosition(view, position)
    play()
    await waitFor(() => expect(view.player().isPlaying()).toBe(true))

    const box = view.part.bars.find((b) => b.bar === view.timeline[position].slot.bar)!
    await waitFor(() => expect(view.scrollTo).toHaveBeenCalled())
    const first = view.scrollTo.mock.lastCall![0].top as number
    expect(first).toBeCloseTo(Math.max(0, pageTop(box.pageIndex) + box.y * (PAGE_WIDTH / PAGE_WIDTH) - LINE_AT * 900), -1)

    seekToPosition(view, 10)
    await waitFor(() => expect(view.scrollTo.mock.lastCall![0].top).not.toBe(first))
  })

  it('stops scrolling at once on pause', async () => {
    const view = await open()
    seekToPosition(view, 10)
    play()
    await waitFor(() => expect(view.player().isPlaying()).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: dock.pause }))
    await waitFor(() => expect(view.player().isPlaying()).toBe(false))
    view.scrollTo.mockClear()

    seekToPosition(view, 60)

    expect(view.scrollTo).not.toHaveBeenCalled()
  })
})

// The follow box reads the editor's timing as it is now (ruling 3): an edit of the timing moves it at once.
describe('the follow box after the timing changes', () => {
  const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
  const STAGE_WIDTH = 1000
  const timingOf = (view: Opened): TimingLayer => view.fakes.store.maps.get(CLARK)!.timing

  /** x on the dock stage for a time, with the stage's window as it is now. */
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

  it('moves to the new timing at once when a locator is dragged later', async () => {
    const view = await open()
    const locator = view.map.timing.locators.find((l) => l.bar === 13 && l.passIndex === 0)!
    clickBar(view, 13)
    // Half a bar after bar 13's locator the playhead is in bar 13 ...
    const between = locator.timeSec + 0.75
    act(() => view.player().seek(between))
    expect(followBars()).toEqual([13])

    // ... and when the line is dragged 1.5 s later it is still in bar 12, with the playhead where it was.
    await waitFor(() => expect(inWindow(locator.timeSec)).toBe(true))
    fireEvent.pointerDown(stage(), { clientX: dockX(locator.timeSec), clientY: 60 })
    fireEvent.pointerMove(stage(), { clientX: dockX(locator.timeSec + 0.75), clientY: 60 })
    fireEvent.pointerMove(stage(), { clientX: dockX(locator.timeSec + 1.5), clientY: 60 })
    fireEvent.pointerUp(stage(), { clientX: dockX(locator.timeSec + 1.5), clientY: 60 })

    await waitFor(() => expect(followBars()).toEqual([12]))
    expect(view.player().getTime()).toBeCloseTo(between, 5)
    const moved = timingOf(view).locators.find((l) => l.bar === 13 && l.passIndex === 0)!
    expect(moved.timeSec).toBeCloseTo(locator.timeSec + 1.5, 6)
  })

  it('moves to the new timing when Realign has refit the unconfirmed locators', async () => {
    const view = await open()
    // Split bar 12 and insert a bar after it (ripple): the new bar 13 has no time, and Realign gives every slot one.
    await view.user.click(screen.getByRole('button', { name: text.modes.add }))
    const box12 = view.part.bars.find((candidate) => candidate.bar === 12)!
    fireEvent.pointerDown(pageEl(box12.pageIndex), { clientX: box12.x + box12.w / 2, clientY: box12.y + 50 })
    fireEvent.pointerUp(pageEl(box12.pageIndex), { clientX: box12.x + box12.w / 2, clientY: box12.y + 50 })
    await view.user.click(screen.getByRole('button', { name: text.modes.move }))
    await turnOnPieceEditing(view.user)
    await view.user.click(screen.getByRole('button', { name: strings.structure.title }))
    const panel = screen.getByRole('region', { name: strings.structure.title })
    const field = within(panel).getByLabelText(strings.structure.bars.insertField)
    await view.user.clear(field)
    await view.user.type(field, '12')
    await view.user.click(within(panel).getByRole('button', { name: strings.structure.bars.insertApply }))
    await confirmPieceChange(view.user)
    await waitFor(() => expect(timingOf(view).barCount).toBe(65))
    const before = buildTimeline(timingOf(view), 271)

    fireEvent.click(within(document.querySelector<HTMLElement>('[data-slot="editor-status"]')!).getByRole('button', { name: text.status.realign }))
    await screen.findByRole('button', { name: text.status.realigning })
    for (let i = 0; i < 10 && screen.queryByRole('button', { name: text.status.realigning }) !== null; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
    }
    await waitFor(() => expect(screen.queryByRole('button', { name: text.status.realign })).toBeNull())
    await waitFor(() => expect(timingOf(view).locators).toHaveLength(74))
    const after = buildTimeline(timingOf(view), 271)

    // A time at which the refit timing and the one before name different bars: the box must follow the refit one.
    let position = -1
    let at = 0
    after.forEach((slot, i) => {
      if (position !== -1) return
      const time = slot.startSec + 0.4 * (slot.endSec - slot.startSec)
      const earlier = slotIndexAt(before, time)
      if (earlier !== -1 && before[earlier].slot.bar !== slot.slot.bar) {
        position = i
        at = time
      }
    })
    expect(position).not.toBe(-1)
    act(() => view.player().seek(at))
    expect(followBars()).toEqual([after[position].slot.bar])
  })
})
