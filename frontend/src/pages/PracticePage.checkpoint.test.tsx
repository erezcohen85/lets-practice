import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beatTimes, buildTimeline, planCountIn } from '@/domain/tempo'
import { nextLoop, rangeLabel } from '@/domain/practice'
import { DEFAULT_SETTINGS, type FollowSettings } from '@/lib/dataClient'
import { createFakes, type Fakes } from '@/lib/fakes'
import { type FakePlayer } from '@/lib/fakes/fakePlayer'
import { type FakeClickSynth } from '@/lib/audio/fakeClickSynth'
import { LINE_AT } from '@/components/practice/useFollowScroll'
import { LONG_PRESS_MS } from '@/components/practice/usePicking'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { barNamesOf } from '@/domain/barNames'

// The original Phase 4 checkpoint, on the demo piece through the real page: pick bars 13-24, 0.75x, a one bar count-in,
// play; the cursor crosses a page boundary, the metronome clicks at the slowed wall spacing, the loop wraps at the end of
// bar 24, next loop moves on, and the piece remembers it all.

const text = strings.practice
const CLARK = 'piece-clark-county'
const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
// One page wide at zoom 1 (the scroll container minus 16 px of padding each side): one image pixel is one screen pixel.
const COLUMN = PAGE_WIDTH + 2 * 16
const VIEW_HEIGHT = 900
// The pages sit 1000 px apart in the column.
const pageTop = (pageIndex: number) => 100 + 1000 * pageIndex
const SPEED = 0.75

// 13-24 from its first time through bar 13: positions 12..31, because the repeat of bars 9-16 comes before bar 17.
const LOOP = { startPosition: 12, endPosition: 31 }
const BAR_17 = 24

interface Media { player?: FakePlayer; synth?: FakeClickSynth }

async function open(fakes: Fakes = createFakes({ seed: 'demo' }), follow: Partial<FollowSettings> = {}) {
  await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, follow: { ...DEFAULT_SETTINGS.follow, ...follow } })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEW_HEIGHT)
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return pageTop(Number(this.dataset.pageIndex ?? 0))
  })
  // jsdom has no Element.scrollTo: this records the call and moves the scroller.
  const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = options.top ?? 0
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })

  const media: Media = {}
  const map = (await fakes.data.getPieceMap(CLARK))!
  const view = renderWithApp(`/pieces/${CLARK}/practice`, { fakes, playerSec: 271, onMedia: (made) => Object.assign(media, made) })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  const timeline = buildTimeline(map.timing, 271)
  const part = map.pages[0]
  return { ...view, fakes, map, timeline, scrollTo, part, boxOf: (bar: number) => part.bars.find((box) => box.bar === bar)!, player: () => media.player!, synth: () => media.synth! }
}
type Opened = Awaited<ReturnType<typeof open>>

const page = (index: number) => {
  const el = document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, right: PAGE_WIDTH, bottom: PAGE_HEIGHT, x: 0, y: 0, toJSON() {} })
  return el
}
const centre = (view: Opened, bar: number) => {
  const box = view.boxOf(bar)
  return { el: page(box.pageIndex), x: box.x + box.w / 2, y: box.y + box.h / 2 }
}
function tapBar(view: Opened, bar: number) {
  const { el, x, y } = centre(view, bar)
  fireEvent.pointerDown(el, { clientX: x, clientY: y })
  fireEvent.pointerUp(el, { clientX: x, clientY: y })
}
async function longPressBar(view: Opened, bar: number) {
  const { el, x, y } = centre(view, bar)
  fireEvent.pointerDown(el, { clientX: x, clientY: y })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 10)
  })
  fireEvent.pointerUp(el, { clientX: x, clientY: y })
}

const field = () => screen.getByRole('textbox', { name: text.loopRange })
const toolbar = () => screen.getByRole('region', { name: text.toolbar })
const countBeat = () => document.querySelector('[data-slot="count-beat"]')
const followBox = () => document.querySelector<HTMLElement>('[data-slot="follow-box"]')
const barReadout = () => within(toolbar()).getByText(/^Bar \d+$/)

/** Lets wall seconds pass in steps: the fake player moves by seconds × its rate, and the engine's frames run. */
function elapse(view: Opened, wallSec: number, stepSec = 0.5) {
  for (let left = wallSec; left > 1e-9; left -= stepSec) {
    const step = Math.min(stepSec, left)
    act(() => {
      view.player().advance(step)
      vi.advanceTimersByTime(step * 1000)
    })
  }
}
/** Wall seconds until the recording reaches a time, at the speed in force. */
const wallUntil = (view: Opened, recSec: number) => (recSec - view.player().getTime()) / SPEED

/** The checkpoint's set-up: pick 13-24 (1st time), 0.75x, a one bar count-in. */
async function setUp(view: Opened) {
  await longPressBar(view, 13)
  tapBar(view, 24)
  expect(field()).toHaveValue('13–24')

  fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.speed(1) }))
  fireEvent.change(screen.getByRole('slider', { name: text.speedHeading }), { target: { value: String(SPEED) } })
  fireEvent.click(within(toolbar()).getByRole('button', { name: text.countInSettings }))
  fireEvent.click(screen.getByRole('radio', { name: text.countInBars(1) }))
  fireEvent.pointerDown(document.body)
}
const play = () => fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Phase 4 checkpoint: 13-24 at 0.75x with a one bar count-in', () => {
  it('counts in as planned, then starts the loop at the recorded time of bar 13', async () => {
    const view = await open()
    await setUp(view)

    const plan = planCountIn(view.timeline, view.map.timing.marks, LOOP.startPosition, { speed: SPEED, tempoSource: 'loop-first-bar', bars: 1 })
    // A bar of 4/4 before the loop: a pre-roll of that bar, four beats as recorded, each 1 / 0.75 as long on the wall.
    const barBefore = view.timeline[11]
    expect(plan).toMatchObject({ type: 'pre-roll', beats: 4 })
    expect(plan.beatWallSec).toBeCloseTo((barBefore.endSec - barBefore.startSec) / 4 / SPEED)
    expect(plan.recordingStartSec).toBeCloseTo(view.timeline[11].startSec)

    play()
    await within(toolbar()).findByRole('button', { name: strings.player.pause })

    expect(view.player().getTime()).toBeCloseTo(plan.recordingStartSec)
    // The count shows its beat each beatWallSec of wall time, 1 to 4 of 4.
    const beats: (string | null)[] = []
    for (let beat = 0; beat < plan.beats; beat++) {
      elapse(view, beat === 0 ? plan.beatWallSec * 0.5 : plan.beatWallSec, 0.05)
      beats.push(countBeat()?.textContent ?? null)
    }
    expect(beats).toEqual(['1', '2', '3', '4'])
    expect(screen.getByRole('status')).toHaveTextContent(text.countBeat(4, plan.beats))

    // The count ends where the loop starts: bar 13 at its recorded time.
    elapse(view, wallUntil(view, view.timeline[LOOP.startPosition].startSec) + 0.1, 0.05)
    expect(countBeat()).toBeNull()
    expect(view.player().isPlaying()).toBe(true)
    expect(view.player().getTime()).toBeGreaterThanOrEqual(view.timeline[LOOP.startPosition].startSec)
    expect(view.player().getTime()).toBeLessThan(view.timeline[LOOP.startPosition].startSec + 0.2)
    expect(barReadout()).toHaveTextContent(text.bar('13'))
  })

  it.each([
    ['line', (view: Opened) => pageTop(1) + view.boxOf(17).y - LINE_AT * VIEW_HEIGHT],
    ['page', () => pageTop(1)],
  ] as const)('is in bar 17 on page 2 at its recorded time, with the score scrolled to it (%s)', async (mode, expectedTop) => {
    const view = await open(undefined, { scroll: mode })
    expect(view.boxOf(17).pageIndex).toBe(1)
    await setUp(view)
    play()
    await within(toolbar()).findByRole('button', { name: strings.player.pause })

    // Through the count-in and bars 13-16 and the repeat of 9-16, on page 1: the score has not gone to page 2 yet.
    elapse(view, wallUntil(view, view.timeline[BAR_17].startSec - 1))
    expect(followBox()!.closest('[data-slot="score-page"]')).toHaveAttribute('data-page-index', '0')
    const before = view.boxOf(Number(followBox()!.getAttribute('data-bar')))
    // Still on page 1: the line of the bar being played, or the top of the page.
    expect(view.scrollTo.mock.lastCall![0].top).toBeCloseTo(mode === 'page' ? pageTop(0) : pageTop(0) + before.y - LINE_AT * VIEW_HEIGHT, -1)

    // Past the boundary, half way through bar 17.
    elapse(view, wallUntil(view, view.timeline[BAR_17].startSec + 1.8), 0.1)

    expect(view.player().getTime()).toBeCloseTo(view.timeline[BAR_17].startSec + 1.8, 1)
    expect(barReadout()).toHaveTextContent(text.bar('17'))
    expect(followBox()).toHaveAttribute('data-bar', '17')
    expect(followBox()!.closest('[data-slot="score-page"]')).toHaveAttribute('data-page-index', '1')
    expect(view.scrollTo.mock.lastCall![0].top).toBe(expectedTop(view))
  })

  it('clicks the metronome on every beat in order at 1.2 s of wall time, the downbeats accented', async () => {
    const view = await open()
    await setUp(view)
    fireEvent.click(within(toolbar()).getByRole('switch', { name: text.metronomeSwitch }))
    const plan = planCountIn(view.timeline, view.map.timing.marks, LOOP.startPosition, { speed: SPEED, tempoSource: 'loop-first-bar', bars: 1 })

    const clicks: { recSec: number; wallSec: number; accent: boolean }[] = []
    const seen = new WeakSet<object>()
    let wallSec = 0
    play()
    await within(toolbar()).findByRole('button', { name: strings.player.pause })
    const drain = () => {
      for (const click of view.synth().scheduled) {
        if (seen.has(click)) continue
        seen.add(click)
        clicks.push({ recSec: view.player().getTime() + click.delaySec * SPEED, wallSec: wallSec + click.delaySec, accent: click.accent })
      }
    }
    // The first frame comes before the music has moved, so the first beat of the count-in bar is not missed.
    act(() => void vi.advanceTimersByTime(20))
    drain()
    // The count-in bar (bar 12), bars 13 and 14 and the first click of bar 15, in small steps so that no click is missed.
    while (clicks.length < 13) {
      elapse(view, 0.05, 0.05)
      wallSec += 0.05
      drain()
    }

    const expected = [11, 12, 13].flatMap((position) => beatTimes(view.timeline[position]))
    expect(expected).toHaveLength(12)
    expect(clicks.slice(0, expected.length).map((click) => click.recSec)).toEqual(expected.map((time) => expect.closeTo(time, 2)))
    expect(clicks.slice(0, expected.length).map((click) => click.accent)).toEqual(expected.map((_, beat) => beat % 4 === 0))
    for (let i = 1; i < expected.length; i++) {
      // A beat of the recording lasts 0.9 s; at 0.75x it lasts what the count-in's beats last on the wall.
      expect(clicks[i].wallSec - clicks[i - 1].wallSec).toBeCloseTo(plan.beatWallSec, 1)
    }
  })

  it('wraps at the end of bar 24 back to bar 13 with no count when "Count in every repeat" is off', async () => {
    const view = await open()
    await setUp(view)
    play()
    await within(toolbar()).findByRole('button', { name: strings.player.pause })
    const end = view.timeline[LOOP.endPosition].endSec
    const start = view.timeline[LOOP.startPosition].startSec
    // A seek inside the loop keeps it looping: jump to the last second of bar 24, then play through the end.
    act(() => view.player().seek(end - 1))
    expect(followBox()).toHaveAttribute('data-bar', '24')

    let latest = 0
    for (let i = 0; i < 150; i++) {
      elapse(view, 0.016, 0.016)
      latest = Math.max(latest, view.player().getTime())
    }

    expect(latest).toBeLessThan(end)
    expect(view.player().isPlaying()).toBe(true)
    expect(view.player().getTime()).toBeGreaterThanOrEqual(start)
    expect(view.player().getTime()).toBeLessThan(start + 1)
    expect(countBeat()).toBeNull()
    expect(followBox()).toHaveAttribute('data-bar', '13')
    expect(field()).toHaveValue('13–24')
  })

  it('counts in again at the wrap when "Count in every repeat" is on', async () => {
    const view = await open()
    await setUp(view)
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.countInSettings }))
    fireEvent.click(screen.getByRole('switch', { name: text.countInEveryRepeat }))
    play()
    await within(toolbar()).findByRole('button', { name: strings.player.pause })
    const end = view.timeline[LOOP.endPosition].endSec
    act(() => view.player().seek(end - 1))
    elapse(view, 0.05, 0.05)
    expect(countBeat()).toBeNull()

    for (let i = 0; i < 150; i++) elapse(view, 0.016, 0.016)

    expect(countBeat()).toHaveTextContent('1')
    // The count of the next pass starts a bar before bar 13, as the first one did.
    expect(view.player().getTime()).toBeGreaterThanOrEqual(view.timeline[11].startSec)
    expect(view.player().getTime()).toBeLessThan(view.timeline[12].startSec)
  })

  it('moves on to the next loop of the same length with the right arrow, and remembers it all when the page is opened again', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const view = await open(fakes)
    await setUp(view)
    fireEvent.click(within(toolbar()).getByRole('switch', { name: text.metronomeSwitch }))
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.countInSettings }))
    fireEvent.click(screen.getByRole('switch', { name: text.countInEveryRepeat }))
    play()
    await within(toolbar()).findByRole('button', { name: strings.player.pause })

    fireEvent.keyDown(document.body, { key: 'ArrowRight' })

    // 20 slots from the slot after the last one: positions 32..51, which are bars 25-44.
    const next = nextLoop(view.timeline, LOOP)!
    expect(next).toEqual({ startPosition: 32, endPosition: 51 })
    expect(rangeLabel(view.timeline, next, barNamesOf(undefined))).toBe('25–44')
    expect(field()).toHaveValue('25–44')
    expect(screen.getByText(text.loopBand('25–44'))).toBeInTheDocument()
    // It counts in from the bar before bar 25.
    expect(view.player().getTime()).toBeCloseTo(view.timeline[31].startSec)
    expect(countBeat()).toHaveTextContent('1')

    // Closing the page saves what the piece remembers.
    view.unmount()
    await waitFor(async () => {
      const stored = (await fakes.data.getPieceMap(CLARK))!.piece.practice
      expect(stored).toMatchObject({ speed: SPEED, loop: next, countInEveryRepeat: true, metronome: { on: true } })
    })

    const again = await open(fakes)
    expect(field()).toHaveValue('25–44')
    expect(within(toolbar()).getByRole('button', { name: strings.player.speed(SPEED) })).toBeInTheDocument()
    expect(within(toolbar()).getByRole('switch', { name: text.metronomeSwitch })).toBeChecked()
    expect(screen.getByText(text.loopBand('25–44'))).toBeInTheDocument()
    expect(again.player().isPlaying()).toBe(false)
  })
})
