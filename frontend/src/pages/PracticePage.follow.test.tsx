import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { buildTimeline } from '@/domain/tempo'
import { DEFAULT_SETTINGS, type FollowSettings, type PlaybackSettings } from '@/lib/dataClient'
import { createFakes, type Fakes } from '@/lib/fakes'
import { type FakePlayer } from '@/lib/fakes/fakePlayer'
import { type FakeClickSynth } from '@/lib/audio/fakeClickSynth'
import { LINE_AT } from '@/components/practice/useFollowScroll'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const text = strings.practice
const CLARK = 'piece-clark-county'
const PAGE_WIDTH = 1240
// One page wide at zoom 1 (the scroll container minus 16 px of padding each side): one image pixel is one screen pixel.
const COLUMN = PAGE_WIDTH + 2 * 16
const VIEW_HEIGHT = 900
// The pages sit 1000 px apart in the column.
const pageTop = (pageIndex: number) => 100 + 1000 * pageIndex

interface Media { player?: FakePlayer; synth?: FakeClickSynth }

/** Practice open on the demo piece, with the score laid out by stubs (jsdom has no layout) and every scroll recorded. */
async function open(follow: Partial<FollowSettings> = {}, nightScore = false, playback: Partial<PlaybackSettings> = {}) {
  const fakes: Fakes = createFakes({ seed: 'demo' })
  await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, nightScore, follow: { ...DEFAULT_SETTINGS.follow, ...follow }, playback: { ...DEFAULT_SETTINGS.playback, ...playback } })
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
  const boxOf = (bar: number) => part.bars.find((box) => box.bar === bar)!
  const player = () => media.player!
  /** The cursor at the middle of the play-order position, or a fraction of the way through it. */
  const seekTo = (position: number, fraction = 0.5) => {
    const { startSec, endSec } = timeline[position]
    act(() => player().seek(startSec + fraction * (endSec - startSec)))
  }
  return { ...view, fakes, scrollTo, timeline, boxOf, player, seekTo, scroller: () => document.querySelector<HTMLElement>('[data-slot="score-scroll"]')! }
}

const followBox = () => document.querySelector<HTMLElement>('[data-slot="follow-box"]')
/** The distance a line is moved along its bar. */
const shift = (element: HTMLElement | null) => Number(/translateX\((.*)px\)/.exec(element!.style.transform)![1])
const followLine = () => document.querySelector<HTMLElement>('[data-slot="follow-line"]')
const lastTop = (view: Awaited<ReturnType<typeof open>>) => view.scrollTo.mock.lastCall?.[0].top
const field = () => screen.getByRole('textbox', { name: text.loopRange })
const toolbar = () => screen.getByRole('region', { name: text.toolbar })

// Position 24 is the first time through bar 17 (page 2); positions 16-23 play bars 9-16 a second time.
const BAR_17 = 24

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Practice page: the box and the gliding line', () => {
  it('draws the box around the playing bar and the line half way along it, mid-bar', async () => {
    const view = await open()

    view.seekTo(BAR_17, 0.5)

    const box = view.boxOf(17)
    expect(followBox()).toHaveAttribute('data-bar', '17')
    expect(followBox()).toHaveStyle({ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` })
    expect(followBox()!.closest('[data-slot="score-page"]')).toHaveAttribute('data-page-index', String(box.pageIndex))
    // A hair past the middle: the cursor looks CURSOR_SLACK_SEC ahead.
    expect(Math.abs(shift(followLine()) - box.w / 2)).toBeLessThan(box.w * 0.02)
  })

  it('shows the box where the player is while paused, and nothing before the first bar', async () => {
    const view = await open()
    expect(followBox()).toBeNull()

    view.seekTo(BAR_17, 0)

    expect(view.player().isPlaying()).toBe(false)
    expect(followBox()).toHaveAttribute('data-bar', '17')
  })

  it('puts the box on the bar just seeked to when the player reads the seek back a hair early', async () => {
    const view = await open()

    act(() => view.player().seek(view.timeline[BAR_17].startSec - 0.01))

    expect(followBox()).toHaveAttribute('data-bar', '17')
  })

  it('follows the second time through the repeat, back on the first page', async () => {
    const view = await open()

    view.seekTo(BAR_17)
    expect(followBox()!.closest('[data-slot="score-page"]')).toHaveAttribute('data-page-index', String(view.boxOf(17).pageIndex))
    view.seekTo(16 + 2)

    expect(followBox()).toHaveAttribute('data-bar', '11')
    expect(followBox()!.closest('[data-slot="score-page"]')).toHaveAttribute('data-page-index', String(view.boxOf(11).pageIndex))
  })

  it('takes the colours of the settings', async () => {
    const view = await open({ boxColour: 'amber', lineColour: 'pink' })

    view.seekTo(BAR_17)

    expect(followBox()!.style.borderColor).toBe('var(--lp-cursor-amber)')
    expect(followLine()!.style.backgroundColor).toBe('var(--lp-cursor-pink)')
  })

  it('leaves out the box when it is off, and the line when it is off', async () => {
    const boxOff = await open({ box: false })
    boxOff.seekTo(BAR_17)
    expect(followBox()).toBeNull()
    expect(followLine()).not.toBeNull()
    boxOff.unmount()

    const lineOff = await open({ line: false })
    lineOff.seekTo(BAR_17)
    expect(followBox()).not.toBeNull()
    expect(followLine()).toBeNull()
  })

  it('takes no pointer, so a tap on the bar under the box still picks it', async () => {
    const view = await open()
    view.seekTo(BAR_17)

    expect(followBox()!.className).toContain('pointer-events-none')
    expect(followBox()!.parentElement!.className).toContain('pointer-events-none')
  })
})

describe('Practice page: scrolling the score', () => {
  it('keeps the playing line in the top of the column, by line', async () => {
    const view = await open()

    view.seekTo(BAR_17)

    const line = view.boxOf(17)
    expect(lastTop(view)).toBe(pageTop(line.pageIndex) + line.y - LINE_AT * VIEW_HEIGHT)
  })

  it('scrolls again only when the line changes', async () => {
    const view = await open()
    view.seekTo(BAR_17)
    const calls = view.scrollTo.mock.calls.length

    view.seekTo(BAR_17 + 1)
    expect(view.scrollTo.mock.calls.length).toBe(calls)

    view.seekTo(BAR_17 + 4)
    expect(view.scrollTo.mock.calls.length).toBe(calls + 1)
    const next = view.boxOf(21)
    expect(lastTop(view)).toBe(pageTop(next.pageIndex) + next.y - LINE_AT * VIEW_HEIGHT)
  })

  it('goes to the top of the next page when the cursor enters it, by page', async () => {
    const view = await open({ scroll: 'page' })
    view.seekTo(2)
    expect(lastTop(view)).toBe(pageTop(0))
    const calls = view.scrollTo.mock.calls.length

    view.seekTo(10)
    expect(view.scrollTo.mock.calls.length).toBe(calls)

    view.seekTo(BAR_17)
    expect(view.scrollTo.mock.calls.length).toBe(calls + 1)
    expect(lastTop(view)).toBe(pageTop(view.boxOf(17).pageIndex))
  })

  it('goes back to the first page when the repeat starts again, by page and by line', async () => {
    const byPage = await open({ scroll: 'page' })
    byPage.seekTo(30)
    expect(lastTop(byPage)).toBe(pageTop(byPage.boxOf(21).pageIndex))
    byPage.seekTo(16)
    expect(lastTop(byPage)).toBe(pageTop(byPage.boxOf(9).pageIndex))
    byPage.unmount()

    const byLine = await open({ scroll: 'line' })
    byLine.seekTo(30)
    byLine.seekTo(16)
    const bar9 = byLine.boxOf(9)
    expect(lastTop(byLine)).toBe(pageTop(bar9.pageIndex) + bar9.y - LINE_AT * VIEW_HEIGHT)
  })

  it('follows in night score too', async () => {
    const view = await open({}, true)

    view.seekTo(BAR_17)

    expect(document.querySelector('[data-slot="practice-score"]')?.className).toContain('invert')
    expect(lastTop(view)).toBe(pageTop(view.boxOf(17).pageIndex) + view.boxOf(17).y - LINE_AT * VIEW_HEIGHT)
    expect(followBox()).not.toBeNull()
  })

  it('stops following when the user scrolls, and follows again at the next bar', async () => {
    const view = await open()
    view.seekTo(BAR_17)
    const calls = view.scrollTo.mock.calls.length

    fireEvent.wheel(view.scroller())
    view.seekTo(BAR_17, 0.9)
    expect(view.scrollTo.mock.calls.length).toBe(calls)

    view.seekTo(BAR_17 + 1)
    expect(view.scrollTo.mock.calls.length).toBe(calls + 1)
  })

  it('follows again when play starts', async () => {
    const view = await open()
    view.seekTo(BAR_17)
    const calls = view.scrollTo.mock.calls.length
    fireEvent.touchMove(view.scroller())

    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    await screen.findByRole('button', { name: strings.player.pause })

    expect(view.scrollTo.mock.calls.length).toBeGreaterThan(calls)
  })

  it('does not take its own scrolling for the user', async () => {
    const view = await open()
    view.seekTo(BAR_17)

    // The browser reports the follow's own scroll as a scroll event; the line after it is followed like any other.
    fireEvent.scroll(view.scroller())
    view.seekTo(BAR_17 + 4)

    const next = view.boxOf(21)
    expect(lastTop(view)).toBe(pageTop(next.pageIndex) + next.y - LINE_AT * VIEW_HEIGHT)
  })
})

describe('Practice page: the keys', () => {
  it('plays and pauses with Space', async () => {
    const view = await open()

    fireEvent.keyDown(document.body, { key: ' ' })
    await screen.findByRole('button', { name: strings.player.pause })
    expect(view.player().isPlaying()).toBe(true)

    fireEvent.keyDown(document.body, { key: ' ' })
    await screen.findByRole('button', { name: strings.player.play })
    expect(view.player().isPlaying()).toBe(false)
  })

  async function withLoop() {
    const view = await open()
    await view.user.clear(field())
    await view.user.type(field(), '17-24{Enter}')
    expect(field()).toHaveValue('17–24')
    return view
  }

  it.each(['ArrowRight', 'PageDown'])('%s moves on to the next loop', async (key) => {
    await withLoop()

    fireEvent.keyDown(document.body, { key })

    expect(field()).toHaveValue('25–32')
  })

  it.each(['ArrowLeft', 'PageUp'])('%s restarts the loop', async (key) => {
    const view = await withLoop()
    view.seekTo(BAR_17 + 5)

    fireEvent.keyDown(document.body, { key })

    await screen.findByRole('button', { name: strings.player.pause })
    expect(view.player().isPlaying()).toBe(true)
    expect(view.player().getTime()).toBeLessThan(view.timeline[BAR_17 + 1].startSec)
  })

  it('does nothing while the range field has the focus', async () => {
    const view = await open()
    field().focus()

    fireEvent.keyDown(field(), { key: ' ' })
    fireEvent.keyDown(field(), { key: 'ArrowRight' })
    fireEvent.keyDown(field(), { key: 'PageUp' })

    expect(view.player().isPlaying()).toBe(false)
    expect(screen.getByRole('button', { name: strings.player.play })).toBeInTheDocument()
  })

  it('leaves the arrows to a slider: a loop handle nudges the loop, it does not also move on', async () => {
    const view = await open()
    await view.user.clear(field())
    await view.user.type(field(), '17-24{Enter}')
    const handle = screen.getByRole('slider', { name: text.loopEnd })

    fireEvent.keyDown(handle, { key: 'ArrowRight' })

    expect(field()).toHaveValue('17–25')
    expect(view.player().isPlaying()).toBe(false)
  })

  it('leaves the arrows to the overview slider', async () => {
    const view = await open()
    view.seekTo(BAR_17)
    const strip = screen.getByRole('slider', { name: text.overview })
    const before = view.player().getTime()

    fireEvent.keyDown(strip, { key: 'ArrowRight' })

    expect(view.player().getTime()).toBeGreaterThan(before)
    expect(view.player().isPlaying()).toBe(false)
  })

  it('plays on a pedal\'s Space after a tap on a toolbar button, without pressing the button again', async () => {
    const view = await open()
    const metronome = within(toolbar()).getByRole('switch', { name: text.metronomeSwitch })
    await view.user.click(metronome)
    expect(metronome).toBeChecked()

    fireEvent.keyDown(metronome, { key: ' ' })

    // The metronome is on, so the music starts after a count-in: the ring already offers Pause.
    await within(toolbar()).findByRole('button', { name: strings.player.pause })
    expect(metronome).toBeChecked()
    expect(metronome).not.toHaveFocus()
  })

  it('keeps Space for a button the keyboard focused: it presses the button and does not play', async () => {
    const view = await open()
    const metronome = within(toolbar()).getByRole('switch', { name: text.metronomeSwitch })
    await view.user.click(metronome)
    expect(metronome).toBeChecked()

    await view.user.tab({ shift: true })
    await view.user.tab()
    expect(metronome).toHaveFocus()
    await view.user.keyboard(' ')

    expect(metronome).not.toBeChecked()
    expect(within(toolbar()).getByRole('button', { name: strings.player.play })).toBeInTheDocument()
  })

  it('works with the toolbar collapsed', async () => {
    const view = await open()
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.collapse }))

    fireEvent.keyDown(document.body, { key: ' ' })

    await waitFor(() => expect(view.player().isPlaying()).toBe(true))
  })
})

describe('Practice page: the count on the score', () => {
  const countLabel = () => document.querySelector<HTMLElement>('[data-slot="count-label"]')

  /** A loop at bars 17-24, played: the one-bar pre-roll is counting. */
  async function counting(...args: Parameters<typeof open>) {
    const view = await open(...args)
    await view.user.clear(field())
    await view.user.type(field(), '17-24{Enter}')
    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    await within(toolbar()).findByRole('button', { name: strings.player.pause })
    return view
  }

  it('shows the beat above the start of the first bar of the loop, on its page, in the colour of the line', async () => {
    const view = await counting({ lineColour: 'amber' })

    const box = view.boxOf(17)
    expect(countLabel()).toHaveTextContent('1')
    expect(countLabel()!.closest('[data-slot="score-page"]')).toHaveAttribute('data-page-index', String(box.pageIndex))
    expect(countLabel()).toHaveStyle({ left: `${box.x}px`, color: 'var(--lp-cursor-amber)' })
    expect(Number.parseFloat(countLabel()!.style.top)).toBeLessThan(box.y)
  })

  it('shows the beat above the bar at the playhead when Play counts in with no loop', async () => {
    const view = await open()
    view.seekTo(BAR_17, 0.5)

    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    await within(toolbar()).findByRole('button', { name: strings.player.pause })

    const box = view.boxOf(17)
    expect(countLabel()).toHaveTextContent('1')
    expect(countLabel()!.closest('[data-slot="score-page"]')).toHaveAttribute('data-page-index', String(box.pageIndex))
    expect(countLabel()).toHaveStyle({ left: `${box.x}px` })
  })

  it('counts on: the next beat replaces the first', async () => {
    const view = await counting()

    act(() => {
      view.player().advance(1.5) // a beat of the demo piece is 1.03 s
      vi.advanceTimersByTime(1500)
    })

    expect(countLabel()).toHaveTextContent('2')
  })

  it('brings the loop first bar into view when the count-in plays the bar before it, on the page before', async () => {
    const view = await counting()

    // Bar 16 (the pre-roll) is the last bar of page 1, and bar 17 is on page 2: the score is on page 2 so the count shows.
    const bar17 = view.boxOf(17)
    expect(view.boxOf(16).pageIndex).not.toBe(bar17.pageIndex)
    expect(lastTop(view)).toBe(pageTop(bar17.pageIndex) + bar17.y - LINE_AT * VIEW_HEIGHT)
  })

  it('leaves the scroll to the cursor when the count is not shown', async () => {
    const view = await counting({}, false, { showCount: false })

    const bar16 = view.boxOf(16)
    expect(lastTop(view)).toBe(pageTop(bar16.pageIndex) + bar16.y - LINE_AT * VIEW_HEIGHT)
  })

  it('is still above the bar when the follow line is off', async () => {
    await counting({ line: false })

    expect(countLabel()).not.toBeNull()
  })

  it('is gone once the loop plays', async () => {
    const view = await counting()

    act(() => {
      view.player().advance(4.2) // the 4.1 s bar before the loop
      vi.advanceTimersByTime(4200)
    })

    expect(countLabel()).toBeNull()
  })

  it('is left out when the setting is off, while the play button still shows the count', async () => {
    await counting({}, false, { showCount: false })

    expect(countLabel()).toBeNull()
    expect(document.querySelector('[data-slot="count-beat"]')).toHaveTextContent('1')
  })

  it('is not there before anything plays', async () => {
    await open()

    expect(countLabel()).toBeNull()
  })
})
