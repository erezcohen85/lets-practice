import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { buildTimeline } from '@/domain/tempo'
import { DEFAULT_SETTINGS } from '@/lib/dataClient'
import { createFakes, type Fakes } from '@/lib/fakes'
import { type FakePlayer } from '@/lib/fakes/fakePlayer'
import { type FakeClickSynth } from '@/lib/audio/fakeClickSynth'
import { addSeedPiece } from '@/lib/fakes/seed'
import { strings } from '@/strings'
import { LONG_PRESS_MS } from '@/components/practice/usePicking'
import { renderWithApp } from '@/test/render'

const text = strings.practice
const CLARK = 'piece-clark-county'
const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
// One page wide at zoom 1 (the scroll container minus 16 px of padding each side): one image pixel is one screen pixel.
const COLUMN = PAGE_WIDTH + 2 * 16

interface Media { player?: FakePlayer; synth?: FakeClickSynth }

/** The Clark County piece of the demo with Practice open on it; the fake player's recording is the demo's 271 s. */
async function open(query = '', fakes: Fakes = createFakes({ seed: 'demo' }), pieceId = CLARK) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const media: Media = {}
  const detail = (await fakes.data.getPiece(pieceId))!
  const map = (await fakes.data.getPieceMap(pieceId))!
  const view = renderWithApp(`/pieces/${pieceId}/practice${query}`, { fakes, playerSec: 271, onMedia: (made) => Object.assign(media, made) })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  const timeline = buildTimeline(map.timing, 271)
  return { ...view, fakes, media, detail, map, timeline, part: map.pages[0], player: () => media.player!, synth: () => media.synth! }
}
type Opened = Awaited<ReturnType<typeof open>>

const page = (index: number) => {
  const el = document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, right: PAGE_WIDTH, bottom: PAGE_HEIGHT, x: 0, y: 0, toJSON() {} })
  return el
}
const boxOf = (view: Opened, bar: number) => view.part.bars.find((box) => box.bar === bar)!
const centre = (view: Opened, bar: number) => {
  const box = boxOf(view, bar)
  return { el: page(box.pageIndex), x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

/** A tap on the bar: pointer down and up at once. */
function tapBar(view: Opened, bar: number, init: object = {}) {
  const { el, x, y } = centre(view, bar)
  fireEvent.pointerDown(el, { clientX: x, clientY: y, ...init })
  fireEvent.pointerUp(el, { clientX: x, clientY: y, ...init })
}
/** A long press on the bar: held for the long press time, then lifted. */
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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Practice page: the screen', () => {
  it('shows the piece, its part and the demo score pages with the toolbar', async () => {
    const view = await open()

    expect(screen.getByRole('heading', { level: 1, name: 'Clark County Celebration' })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /^Page \d of 4$/ })).toHaveLength(4)
    expect(document.querySelector('[data-slot="part-chip"]')).toHaveTextContent('Clarinet in B♭ 1')
    expect(screen.getByRole('link', { name: text.pieceHub })).toHaveAttribute('href', `/pieces/${CLARK}`)
    expect(view.player().loadedUrl).toMatch(/^data:audio\/wav/)
    expect(toolbar()).toBeInTheDocument()
  })

  it('has no page line above the score', async () => {
    await open()

    expect(document.querySelector('[data-slot="page-label"]')).toBeNull()
    expect(screen.queryByText(/^Page \d of 4 ·/)).toBeNull()
  })

  it('draws no problem colours: every bar box is plain, and the toolbar has no problem tokens', async () => {
    await open()

    const states = [...document.querySelectorAll('[data-slot="bar-box"]')].map((box) => box.getAttribute('data-state'))
    expect(new Set(states)).toEqual(new Set(['plain']))
    expect(document.querySelector('[class*="problem"], [class*="moved"]')).toBeNull()
  })

  it('opens the hub when its back link is followed, and the piece hub Practice buttons land here', async () => {
    const { user, router } = renderWithApp(`/pieces/${CLARK}`, { seed: 'demo', playerSec: 271 })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)

    await user.click(await screen.findByRole('link', { name: strings.hub.practice }))
    expect(router.state.location.pathname).toBe(`/pieces/${CLARK}/practice`)
    await screen.findByRole('region', { name: text.toolbar })
    await user.click(screen.getByRole('link', { name: text.pieceHub }))

    expect(router.state.location.pathname).toBe(`/pieces/${CLARK}`)
  })

  it('opens the part named in the address and takes the part from the toolbar menu', async () => {
    const view = await open()
    const detail = view.detail

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Clarinet in B♭ 1' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Flute 1' }))

    await waitFor(() => expect(view.router.state.location.search).toBe(`?part=${detail.parts[2].id}`))
    expect(document.querySelector('[data-slot="part-chip"]')).toHaveTextContent('Flute 1')
  })

  it('remembers the part it opened, and the part it is switched to', async () => {
    const view = await open()
    const { parts } = view.detail
    await waitFor(() => expect(view.fakes.store.pieces.get(CLARK)?.lastPartId).toBe(parts[0].id))

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Clarinet in B♭ 1' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Flute 1' }))

    await waitFor(() => expect(view.fakes.store.pieces.get(CLARK)?.lastPartId).toBe(parts[2].id))
  })

  it('shows the part names only in the part menu, with the current one checked', async () => {
    await open()

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Clarinet in B♭ 1' }))

    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual(['Clarinet in B♭ 1', 'Trumpet in B♭ 2', 'Flute 1'])
    expect(items[0]).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menu', { name: text.partMenu }).querySelector('[class*="bg-"]:not([class*="hover"])')).toBeNull()
  })

  it('shows the hub for a piece that is still processing by sending the user to its processing screen', async () => {
    const { router } = renderWithApp('/pieces/piece-slow-waltz/practice', { seed: 'demo' })

    await waitFor(() => expect(router.state.location.pathname).toBe('/pieces/piece-slow-waltz/processing'))
  })

  it('plays a piece from its stored recording', async () => {
    const fakes = createFakes({ seed: 'demo' })
    addSeedPiece(fakes.store, {
      id: 'piece-tube',
      title: 'From a link',
      createdAt: '2026-10-01T00:00:00.000Z',
      recording: { kind: 'file', name: 'take.mp3' },
      durationSec: 271,
      parts: [{ name: 'Piano' }],
      spec: undefined,
      job: 'done',
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
    const media: Media = {}
    renderWithApp('/pieces/piece-tube/practice', { fakes, playerSec: 271, onMedia: (made) => Object.assign(media, made) })

    const play = await screen.findByRole('button', { name: strings.player.play })
    await waitFor(() => expect(media.player?.loadedUrl).toMatch(/^data:audio\/wav/))
    fireEvent.click(play)

    await waitFor(() => expect(media.player?.isPlaying()).toBe(true))
    expect(screen.getByRole('button', { name: strings.player.pause })).toBeInTheDocument()
  })

  it('says so when the piece has no recording', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.data, 'getAudioUrl').mockResolvedValue(null)
    renderWithApp(`/pieces/${CLARK}/practice`, { fakes })

    expect(await screen.findByText(text.noRecording)).toBeInTheDocument()
  })

  it('inverts the page images when night score is on in the settings', async () => {
    const fakes = createFakes({ seed: 'demo' })
    await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, nightScore: true })
    await open('', fakes)

    expect(document.querySelector('[data-slot="practice-score"]')?.className).toContain('invert')
  })

  it('keeps the paper as it is when night score is off', async () => {
    await open()

    expect(document.querySelector('[data-slot="practice-score"]')?.className).not.toContain('invert')
  })
})

describe('Practice page: opening on a bar', () => {
  it('puts the playhead on the bar named in the address without playing', async () => {
    const view = await open('?bar=17')

    await waitFor(() => expect(view.player().getTime()).toBeCloseTo(view.timeline[24].startSec))
    expect(view.player().isPlaying()).toBe(false)
    expect(within(toolbar()).getByText(text.bar('17'))).toBeInTheDocument()
  })

  it('names the bar of a playhead that a media element reads back a hair before the bar start', async () => {
    const view = await open()

    act(() => view.player().seek(view.timeline[24].startSec - 0.01))

    expect(within(toolbar()).getByText(text.bar('17'))).toBeInTheDocument()
  })

  it('ignores a bar that is not in the part', async () => {
    const view = await open('?bar=999')

    expect(view.player().getTime()).toBe(0)
  })

  it('has the Practice / Edit switch at the end of the top bar, on Practice, in place of the Edit map link', async () => {
    const view = await open()

    const group = screen.getByRole('group', { name: strings.common.viewSwitch })
    expect(within(group).getByRole('link', { name: strings.common.viewPractice })).toHaveAttribute('aria-current', 'page')
    expect(within(group).getByRole('link', { name: strings.common.viewPractice })).toHaveAttribute('href', `/pieces/${CLARK}/practice?part=${view.detail.parts[0].id}`)
    expect(within(group).getByRole('link', { name: strings.common.viewEdit })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('link', { name: 'Edit map' })).toBeNull()
  })

  it('carries the bar the cursor is in on the Edit side of the switch', async () => {
    const view = await open('?bar=17')

    await waitFor(() => expect(screen.getByRole('link', { name: strings.common.viewEdit })).toHaveAttribute('href', `/pieces/${CLARK}/edit?part=${view.detail.parts[0].id}&bar=17`))
  })

  it('leaves the bar off the Edit side of the switch while the playhead is before the first bar', async () => {
    const view = await open()

    expect(screen.getByRole('link', { name: strings.common.viewEdit })).toHaveAttribute('href', `/pieces/${CLARK}/edit?part=${view.detail.parts[0].id}`)
  })

  it('follows the cursor on the Edit side of the switch', async () => {
    const view = await open()

    tapBar(view, 20)

    await waitFor(() => expect(screen.getByRole('link', { name: strings.common.viewEdit }).getAttribute('href')).toMatch(/&bar=20$/))
  })
})

describe('Practice page: picking', () => {
  it('moves the playhead to the bar of a single tap and does not start playing', async () => {
    const view = await open()

    tapBar(view, 20)

    await waitFor(() => expect(view.player().getTime()).toBeCloseTo(view.timeline[27].startSec, 1))
    expect(view.player().isPlaying()).toBe(false)
    expect(field()).toHaveValue('')
    expect(document.querySelector('[data-slot="range-tint"]')).toBeNull()
  })

  it('selects a bar played twice at the pass nearest the current time', async () => {
    const view = await open()
    tapBar(view, 20)
    await waitFor(() => expect(view.player().getTime()).toBeCloseTo(view.timeline[27].startSec, 1))
    view.player().seek(view.timeline[21].startSec + 0.1)

    tapBar(view, 13)

    expect(view.player().getTime()).toBeCloseTo(view.timeline[20].startSec, 1)
  })

  it('does not play when a press moves away before it is lifted', async () => {
    const view = await open()
    const { el, x, y } = centre(view, 20)

    fireEvent.pointerDown(el, { clientX: x, clientY: y })
    fireEvent.pointerMove(el, { clientX: x + 60, clientY: y + 60 })
    fireEvent.pointerUp(el, { clientX: x + 60, clientY: y + 60 })

    expect(view.player().isPlaying()).toBe(false)
  })

  it('starts a range with a long press: the bar is tinted and the hint says to tap the last bar', async () => {
    const view = await open()

    await longPressBar(view, 17)

    expect(document.querySelector('[data-slot="range-pending"]')).toHaveAttribute('data-bar', '17')
    expect(screen.getByText(text.pickHint)).toBeInTheDocument()
    expect(view.player().isPlaying()).toBe(false)
  })

  it('sets 13-24 with no question when the loop starts on a repeated bar and the play line is before it', async () => {
    const view = await open()

    await longPressBar(view, 13)
    tapBar(view, 24)

    expect(screen.queryByRole('group', { name: text.passQuestion('13') })).toBeNull()
    expect(field()).toHaveValue('13–24')
    // 13 to 24 in the first pass runs through the repeat (bars 9-16 again) on its way to 17, so bars 9-24 are tinted.
    expect(document.querySelectorAll('[data-slot="range-tint"]')).toHaveLength(16)
    expect(screen.getByText(text.loopBand('13–24'))).toBeInTheDocument()
  })

  it('sets 13 (2)-24 with no question when the play line is in the second time through bar 13', async () => {
    const view = await open()
    view.player().seek(view.timeline[21].startSec + 0.1)

    await longPressBar(view, 13)
    tapBar(view, 24)

    expect(screen.queryByRole('group', { name: text.passQuestion('13') })).toBeNull()
    expect(field()).toHaveValue('13 (2)–24')
    expect([...document.querySelectorAll('[data-slot="range-tint"]')].map((tint) => tint.getAttribute('data-bar'))).toContain('20')
  })

  it('sets the range straight away when its first bar is played once', async () => {
    const view = await open()

    await longPressBar(view, 17)
    tapBar(view, 24)

    expect(field()).toHaveValue('17–24')
    expect(screen.queryByText(text.pickHint)).toBeNull()
    expect(document.querySelectorAll('[data-slot="range-tint"]')).toHaveLength(8)
    expect(document.querySelector('[data-slot="loop-band"]')).toBeInTheDocument()
    expect(screen.getByText(text.loopBand('17–24'))).toBeInTheDocument()
  })

  it('lets the lower bar start when the taps come in reverse, and takes the pass of the lower bar', async () => {
    const view = await open()
    view.player().seek(view.timeline[21].startSec + 0.1)

    await longPressBar(view, 24)
    tapBar(view, 13)

    expect(screen.queryByRole('group', { name: text.passQuestion('13') })).toBeNull()
    expect(field()).toHaveValue('13 (2)–24')
  })

  it('cancels the pending range with Escape', async () => {
    const view = await open()
    await longPressBar(view, 17)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(document.querySelector('[data-slot="range-pending"]')).toBeNull()
    expect(screen.queryByText(text.pickHint)).toBeNull()
    expect(field()).toHaveValue('')
  })

  it('makes a one-bar loop of a long press and a tap on the same bar', async () => {
    const view = await open()
    await longPressBar(view, 17)

    tapBar(view, 17)

    expect(document.querySelector('[data-slot="range-pending"]')).toBeNull()
    expect(screen.queryByText(text.pickHint)).toBeNull()
    expect(field()).toHaveValue('17–17')
    expect([...document.querySelectorAll('[data-slot="range-tint"]')].map((tint) => tint.getAttribute('data-bar'))).toEqual(['17'])
    expect(view.player().isPlaying()).toBe(false)
  })

  it('makes a one-bar loop of a Shift+click on the bar just tapped', async () => {
    const view = await open()
    tapBar(view, 17)
    await waitFor(() => expect(view.player().getTime()).toBeGreaterThan(0))

    tapBar(view, 17, { shiftKey: true })

    expect(field()).toHaveValue('17–17')
  })

  it('makes a one-bar loop of one bar typed in the field', async () => {
    await open()

    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: '17' } })
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(field()).toHaveValue('17–17')
  })

  it('cancels the pending range with a tap off the bars', async () => {
    const view = await open()
    await longPressBar(view, 17)

    const el = page(boxOf(view, 17).pageIndex)
    fireEvent.pointerDown(el, { clientX: 1, clientY: 1 })
    expect(screen.getByText(text.pickHint)).toBeInTheDocument()
    fireEvent.pointerUp(el, { clientX: 1, clientY: 1 })

    expect(document.querySelector('[data-slot="range-pending"]')).toBeNull()
    expect(screen.queryByText(text.pickHint)).toBeNull()
    expect(field()).toHaveValue('')
    expect(view.player().isPlaying()).toBe(false)
  })

  it('keeps the pending range through a scroll that starts off the bars', async () => {
    const view = await open()
    await longPressBar(view, 17)

    const el = page(boxOf(view, 17).pageIndex)
    fireEvent.pointerDown(el, { clientX: 1, clientY: 1 })
    fireEvent.pointerMove(el, { clientX: 1, clientY: 60 })
    fireEvent.pointerUp(el, { clientX: 1, clientY: 60 })

    expect(screen.getByText(text.pickHint)).toBeInTheDocument()
    expect(document.querySelector('[data-slot="range-pending"]')).toBeInTheDocument()
  })

  it('treats Shift+click after a tap as a long press on the tapped bar and a tap on this one', async () => {
    const view = await open()
    tapBar(view, 17)
    await waitFor(() => expect(view.player().getTime()).toBeGreaterThan(0))

    tapBar(view, 24, { shiftKey: true })

    expect(field()).toHaveValue('17–24')
  })

  it('takes the pass of the play line for a Shift+click loop on a repeated bar, with no question', async () => {
    const view = await open()
    view.player().seek(view.timeline[21].startSec + 0.1)
    tapBar(view, 13)
    await waitFor(() => expect(view.player().getTime()).toBeCloseTo(view.timeline[20].startSec, 1))

    tapBar(view, 24, { shiftKey: true })

    expect(screen.queryByRole('group', { name: text.passQuestion('13') })).toBeNull()
    expect(field()).toHaveValue('13 (2)–24')
  })

  it('only selects the bar for a Shift+click with no tap before it', async () => {
    const view = await open()

    tapBar(view, 24, { shiftKey: true })

    await waitFor(() => expect(view.player().getTime()).toBeGreaterThan(0))
    expect(view.player().isPlaying()).toBe(false)
    expect(field()).toHaveValue('')
  })

  it('does not pick a bar through the choice buttons or a handle', async () => {
    const view = await open()
    await longPressBar(view, 17)
    tapBar(view, 24)

    const handle = screen.getByRole('slider', { name: text.loopStart })
    fireEvent.pointerDown(handle, { clientX: 1, clientY: 1 })
    fireEvent.pointerUp(handle, { clientX: 1, clientY: 1 })

    expect(view.player().isPlaying()).toBe(false)
  })
})

const passToggle = (bar = '13') => screen.queryByRole('group', { name: text.passQuestion(bar) })
const passButton = (pass: number) => within(passToggle()!).getByRole('button', { name: text.passChoice(pass) })

// Erez, 2026-11-06: the 1st / 2nd time control belongs to a tap that starts play on a repeated bar, not to a loop.
describe('Practice page: which time through, on a tap', () => {
  it('moves the play line to the pass nearest it and shows a toggle with that pass pressed', async () => {
    const view = await open()
    view.player().seek(view.timeline[21].startSec + 0.1)

    tapBar(view, 13)

    await waitFor(() => expect(view.player().getTime()).toBeCloseTo(view.timeline[20].startSec, 1))
    expect(within(passToggle()!).getAllByRole('button').map((button) => button.textContent)).toEqual(['1st time', '2nd time'])
    expect(passButton(2)).toHaveAttribute('aria-pressed', 'true')
    expect(passButton(1)).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks the pressed pass by shape too, a tick, not by colour alone', async () => {
    const view = await open()

    tapBar(view, 13)

    await waitFor(() => expect(passButton(1)).toHaveAttribute('aria-pressed', 'true'))
    expect(passButton(1).querySelector('svg')).not.toBeNull()
    expect(passButton(2).querySelector('svg')).toBeNull()
  })

  it('moves the play line to the start of the other pass and leaves the toggle open', async () => {
    const view = await open()
    tapBar(view, 13)
    await waitFor(() => expect(passButton(1)).toHaveAttribute('aria-pressed', 'true'))

    fireEvent.click(passButton(2))

    await waitFor(() => expect(view.player().getTime()).toBeCloseTo(view.timeline[20].startSec, 1))
    expect(passButton(2)).toHaveAttribute('aria-pressed', 'true')
    expect(passButton(1)).toHaveAttribute('aria-pressed', 'false')
    expect(view.player().isPlaying()).toBe(false)
    expect(field()).toHaveValue('')
  })

  it('shows nothing for a bar played once', async () => {
    const view = await open()

    tapBar(view, 20)

    await waitFor(() => expect(view.player().getTime()).toBeCloseTo(view.timeline[27].startSec, 1))
    expect(document.querySelector('[data-slot="pass-choice"]')).toBeNull()
  })

  it('closes with Escape, with a tap on another bar and with a tap off the bars', async () => {
    const view = await open()
    tapBar(view, 13)
    expect(passToggle()).not.toBeNull()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(passToggle()).toBeNull()

    tapBar(view, 13)
    expect(passToggle()).not.toBeNull()
    tapBar(view, 30)
    expect(passToggle()).toBeNull()

    tapBar(view, 13)
    expect(passToggle()).not.toBeNull()
    const el = page(0)
    fireEvent.pointerDown(el, { clientX: 2, clientY: 2 })
    fireEvent.pointerUp(el, { clientX: 2, clientY: 2 })
    expect(passToggle()).toBeNull()
  })

  it('moves to the toggle of another repeated bar', async () => {
    const view = await open()
    tapBar(view, 13)

    tapBar(view, 14)

    expect(passToggle('13')).toBeNull()
    expect(passToggle('14')).not.toBeNull()
  })

  it('closes when a long press starts a range', async () => {
    const view = await open()
    tapBar(view, 13)

    await longPressBar(view, 17)

    expect(passToggle()).toBeNull()
    expect(document.querySelector('[data-slot="range-pending"]')).toHaveAttribute('data-bar', '17')
  })

  it('closes when Play starts the music', async () => {
    const view = await open()
    tapBar(view, 13)
    expect(passToggle()).not.toBeNull()

    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))

    await waitFor(() => expect(view.player().isPlaying()).toBe(true))
    expect(passToggle()).toBeNull()
  })

  it('keeps playing and shows the toggle for a tap during play', async () => {
    const view = await open()
    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    await waitFor(() => expect(view.player().isPlaying()).toBe(true))

    tapBar(view, 13)

    await waitFor(() => expect(view.player().getTime()).toBeCloseTo(view.timeline[12].startSec, 1))
    expect(view.player().isPlaying()).toBe(true)
    expect(passToggle()).not.toBeNull()
    fireEvent.click(passButton(2))
    await waitFor(() => expect(view.player().getTime()).toBeCloseTo(view.timeline[20].startSec, 1))
    expect(view.player().isPlaying()).toBe(true)
    expect(passToggle()).not.toBeNull()
  })

  it('does not take the focus, so Space still plays', async () => {
    const view = await open()
    tapBar(view, 13)

    expect(passToggle()!.contains(document.activeElement)).toBe(false)
    fireEvent.keyDown(document.body, { key: ' ' })

    await waitFor(() => expect(view.player().isPlaying()).toBe(true))
  })
})

// Partita, Erez 2026-11-06: a pass with no locator of its own has no time in the recording; the seek went to the recording's end.
describe('Practice page: a time through with no locator', () => {
  /** Practice on the demo piece with bar 13's second time through unlocated; the timeline the page builds from it. */
  async function openWithoutSecond() {
    const fakes = createFakes({ seed: 'demo' })
    const timing = (await fakes.data.getPieceMap(CLARK))!.timing
    await fakes.data.saveTiming(CLARK, { ...timing, locators: timing.locators.filter((locator) => !(locator.bar === 13 && locator.passIndex === 1)) })
    const view = await open('', fakes)
    const timeline = buildTimeline((await fakes.data.getPieceMap(CLARK))!.timing, 271)
    expect(timeline[20]).toMatchObject({ interpolated: true })
    return { view, timeline }
  }

  it('keeps the pass in the toggle, disabled, with the reason, and never seeks on it', async () => {
    const { view } = await openWithoutSecond()
    tapBar(view, 13)
    await waitFor(() => expect(passButton(1)).toHaveAttribute('aria-pressed', 'true'))
    const before = view.player().getTime()

    expect(passButton(2)).toBeDisabled()
    expect(passButton(2)).toHaveAttribute('title', text.passNoTime)
    expect(passButton(1)).not.toHaveAttribute('title')
    fireEvent.click(passButton(2))

    expect(view.player().getTime()).toBe(before)
    expect(passButton(1)).toHaveAttribute('aria-pressed', 'true')
  })

  it('marks the disabled pass by form as well as colour: dimmed with a dashed border', async () => {
    const { view } = await openWithoutSecond()

    tapBar(view, 13)

    // jsdom draws no CSS: the classes that apply only to a disabled button carry the dashed border and the dimming.
    expect(passButton(2)).toBeDisabled()
    expect(passButton(2).className).toContain('disabled:border-dashed')
    expect(passButton(2).className).toContain('disabled:opacity-60')
  })

  it('lands a tap on the pass that has a time, even when the play line sits in the one that has none', async () => {
    const { view, timeline } = await openWithoutSecond()
    view.player().seek(timeline[20].startSec + 0.1)

    tapBar(view, 13)

    await waitFor(() => expect(view.player().getTime()).toBeCloseTo(timeline[12].startSec, 1))
    expect(passButton(1)).toHaveAttribute('aria-pressed', 'true')
    expect(passButton(2)).toHaveAttribute('aria-pressed', 'false')
  })

  it('starts a loop on the pass that has a time, with no question', async () => {
    const { view, timeline } = await openWithoutSecond()
    view.player().seek(timeline[20].startSec + 0.1)

    await longPressBar(view, 13)
    tapBar(view, 24)

    expect(passToggle()).toBeNull()
    expect(field()).toHaveValue('13–24')
  })
})

/** What shows of the loop: the range tint on the score, its two handles and the band on the overview strip. */
const marks = () => ({
  tints: document.querySelectorAll('[data-slot="range-tint"]').length,
  handles: document.querySelectorAll('[data-slot="range-handle"]').length,
  band: document.querySelector('[data-slot="loop-band"]') !== null,
})

describe('Practice page: moving outside the loop', () => {
  const loopButton = () => within(toolbar()).getByRole('button', { name: text.loop })

  /** Loop 17-24 set from the field. */
  async function withLoop(query = '', fakes?: Fakes) {
    const view = await open(query, fakes)
    await view.user.clear(field())
    await view.user.type(field(), '17-24{Enter}')
    return view
  }

  it('shows the Loop button on once a range is set', async () => {
    await withLoop()

    expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
  })

  it('disables the Loop button while there is no range', async () => {
    await open()

    expect(loopButton()).toBeDisabled()
    expect(loopButton()).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps looping when a bar inside the range is tapped', async () => {
    const view = await withLoop()

    tapBar(view, 20)

    await waitFor(() => expect(view.player().getTime()).toBeGreaterThan(0))
    expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
  })

  it('turns looping off when a bar outside the range is tapped, keeping the range tinted and remembered', async () => {
    const view = await withLoop()

    tapBar(view, 30)

    await waitFor(() => expect(loopButton()).toHaveAttribute('aria-pressed', 'false'))
    expect(field()).toHaveValue('17–24')
    // Off means no marks: the range stays in the field, remembered, and nowhere else.
    expect(marks()).toEqual({ tints: 0, handles: 0, band: false })
  })

  it('turns looping off on a press of the overview strip outside the range, and not inside it', async () => {
    await withLoop()
    const strip = screen.getByRole('slider', { name: text.overview })
    strip.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 64, right: 1000, bottom: 64, x: 0, y: 0, toJSON() {} })

    // Bars 17-24 run from about 102 s to 135 s of 271 s: 40 % is 108 s.
    fireEvent.pointerDown(strip, { clientX: 400, clientY: 30 })
    expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerDown(strip, { clientX: 800, clientY: 30 })

    await waitFor(() => expect(loopButton()).toHaveAttribute('aria-pressed', 'false'))
    expect(marks()).toEqual({ tints: 0, handles: 0, band: false })
  })

  it('opens with looping off when ?bar= is outside the remembered loop, and Play then plays from the bar', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const first = await withLoop('', fakes)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    first.unmount()

    const view = await open('?bar=40', fakes)

    await waitFor(() => expect(loopButton()).toHaveAttribute('aria-pressed', 'false'))
    expect(field()).toHaveValue('17–24')
    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    await waitFor(() => expect(view.player().isPlaying()).toBe(true))
    // Play counts in (Erez, 2026-11-03): the pre-roll plays the bar before bar 40's slot, then bar 40 itself.
    expect(view.player().getTime()).toBeGreaterThanOrEqual(view.timeline[46].startSec - 0.1)
    expect(view.player().getTime()).toBeLessThan(view.timeline[47].endSec)
  })

  it('opens with looping on when ?bar= is inside the remembered loop', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const first = await withLoop('', fakes)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    first.unmount()

    await open('?bar=20', fakes)

    expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
  })

  it('turns looping back on with the Loop button, at the loop start', async () => {
    const view = await withLoop()
    tapBar(view, 30)
    await waitFor(() => expect(loopButton()).toHaveAttribute('aria-pressed', 'false'))

    fireEvent.click(loopButton())

    expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
    expect(view.player().getTime()).toBeCloseTo(view.timeline[24].startSec, 1)
  })

  it('turns looping off with the Loop button when it is on', async () => {
    await withLoop()

    fireEvent.click(loopButton())

    expect(loopButton()).toHaveAttribute('aria-pressed', 'false')
  })

  it('turns looping on again with restart', async () => {
    const view = await withLoop()
    tapBar(view, 30)
    await waitFor(() => expect(loopButton()).toHaveAttribute('aria-pressed', 'false'))

    fireEvent.click(within(toolbar()).getByRole('button', { name: text.restart }))

    expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Practice page: the loop handles', () => {
  it('shows a handle at each end of the range, named for the bar it is at', async () => {
    const view = await open()
    await longPressBar(view, 17)
    tapBar(view, 24)

    expect(screen.getByRole('slider', { name: text.loopStart })).toHaveAttribute('aria-valuetext', text.bar('17'))
    expect(screen.getByRole('slider', { name: text.loopEnd })).toHaveAttribute('aria-valuetext', text.bar('24'))
  })

  it('moves the end by whole bars when its handle is dragged', async () => {
    const view = await open()
    await longPressBar(view, 17)
    tapBar(view, 24)
    const handle = screen.getByRole('slider', { name: text.loopEnd })
    const target = centre(view, 28)
    page(boxOf(view, 28).pageIndex)

    fireEvent.pointerDown(handle, { clientX: 5, clientY: 5 })
    fireEvent.pointerMove(window, { clientX: target.x, clientY: target.y })
    fireEvent.pointerUp(window, { clientX: target.x, clientY: target.y })

    expect(field()).toHaveValue('17–28')
    // Once lifted, the pointer no longer moves it.
    const other = centre(view, 30)
    fireEvent.pointerMove(window, { clientX: other.x, clientY: other.y })
    expect(field()).toHaveValue('17–28')
  })

  it('moves the start by whole bars when its handle is dragged', async () => {
    const view = await open()
    await longPressBar(view, 17)
    tapBar(view, 24)
    const handle = screen.getByRole('slider', { name: text.loopStart })
    const target = centre(view, 19)
    page(boxOf(view, 19).pageIndex)

    fireEvent.pointerDown(handle, { clientX: 5, clientY: 5 })
    fireEvent.pointerMove(window, { clientX: target.x, clientY: target.y })
    fireEvent.pointerUp(window)

    expect(field()).toHaveValue('19–24')
  })

  it('moves an edge a bar at a time with the arrow keys', async () => {
    const view = await open()
    await longPressBar(view, 17)
    tapBar(view, 24)

    fireEvent.keyDown(screen.getByRole('slider', { name: text.loopEnd }), { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('slider', { name: text.loopStart }), { key: 'ArrowLeft' })

    // One position before bar 17 is the second pass of bar 16, which the repeat plays just before it.
    expect(field()).toHaveValue('16 (2)–25')
  })
})

describe('Practice page: the range field', () => {
  async function submit(user: Opened['user'], value: string) {
    await user.clear(field())
    if (value !== '') await user.type(field(), value)
    await user.keyboard('{Enter}')
  }

  it('sets the loop from what is typed, a second pass included', async () => {
    const view = await open()

    await submit(view.user, '13 (2)-24')

    expect(field()).toHaveValue('13 (2)–24')
    expect(document.querySelector('[data-slot="loop-band"]')).toBeInTheDocument()
  })

  it('rejects 70-80 with a message under the field and leaves the loop alone', async () => {
    const view = await open()
    await submit(view.user, '17-24')

    await submit(view.user, '70-80')

    expect(screen.getByRole('alert')).toHaveTextContent(text.rangeErrors['unknown-bar'])
    expect(field()).toHaveValue('70-80')
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(field()).toHaveValue('17–24')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['soon', 'format'],
    ['24-17', 'order'],
  ] as const)('says why %s is not a loop', async (typed, reason) => {
    const view = await open()

    await submit(view.user, typed)

    expect(screen.getByRole('alert')).toHaveTextContent(text.rangeErrors[reason])
  })

  it('clears the loop when the field is emptied', async () => {
    const view = await open()
    await submit(view.user, '17-24')

    await submit(view.user, '')

    expect(field()).toHaveValue('')
    expect(document.querySelector('[data-slot="loop-band"]')).toBeNull()
  })

  it('puts the label back when the field is left with a text that is not a loop', async () => {
    const view = await open()
    await submit(view.user, '17-24')
    await view.user.clear(field())
    await view.user.type(field(), '70-80')
    await view.user.keyboard('{Enter}')

    await view.user.tab()

    expect(field()).toHaveValue('17–24')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the loop when the part changes', async () => {
    const view = await open()
    await submit(view.user, '17-24')

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Clarinet in B♭ 1' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Trumpet in B♭ 2' }))

    await waitFor(() => expect(view.router.state.location.search).toContain(view.detail.parts[1].id))
    await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
    expect(field()).toHaveValue('17–24')
    expect(document.querySelectorAll('[data-slot="range-tint"]').length).toBeGreaterThan(0)
  })
})

describe('Practice page: the toolbar', () => {
  it('plays and pauses from the ring button and shows the cursor bar and the time', async () => {
    const view = await open('?bar=17')
    await waitFor(() => expect(within(toolbar()).getByText(text.bar('17'))).toBeInTheDocument())

    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    await waitFor(() => expect(view.player().isPlaying()).toBe(true))
    act(() => view.player().advance(1))

    fireEvent.click(await within(toolbar()).findByRole('button', { name: strings.player.pause }))
    expect(view.player().isPlaying()).toBe(false)
    expect(within(toolbar()).getByText(/^\d+:\d\d \/ 4:31$/)).toBeInTheDocument()
  })

  it('restarts the loop from the restart button', async () => {
    const view = await open()
    await view.user.clear(field())
    await view.user.type(field(), '17-24{Enter}')

    fireEvent.click(within(toolbar()).getByRole('button', { name: text.restart }))

    await waitFor(() => expect(view.player().isPlaying()).toBe(true))
    expect(screen.getByRole('button', { name: strings.player.pause })).toBeInTheDocument()
  })

  it('counts in before the loop and shows the beat in the ring', async () => {
    const view = await open()
    await view.user.clear(field())
    await view.user.type(field(), '17-24{Enter}')

    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))

    await waitFor(() => expect(within(toolbar()).getByRole('button', { name: strings.player.pause })).toBeInTheDocument())
    expect(document.querySelector('[data-slot="count-beat"]')).toHaveTextContent('1')
    // The one-bar pre-roll starts a bar before bar 17.
    expect(view.player().getTime()).toBeCloseTo(view.timeline[23].startSec, 1)
  })

  it('counts in with the pre-roll in the part that plays the bar before the loop, and with clicks in the part that rests it', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const parts = (await fakes.data.getPiece(CLARK))!.parts
    // The demo's clarinet (first part) rests on bars 5-8; its flute (third part) plays them.
    const clarinet = await open(`?part=${parts[0].id}`, fakes)
    await clarinet.user.clear(field())
    await clarinet.user.type(field(), '9-12{Enter}')
    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    await waitFor(() => expect(within(toolbar()).getByRole('button', { name: strings.player.pause })).toBeInTheDocument())
    // Clicks: the recording waits at bar 9 itself, not at the bar before it.
    expect(clarinet.player().getTime()).toBeCloseTo(clarinet.timeline[8].startSec, 1)
    clarinet.unmount()

    const flute = await open(`?part=${parts[2].id}`, fakes)
    await flute.user.clear(field())
    await flute.user.type(field(), '9-12{Enter}')
    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    await waitFor(() => expect(within(toolbar()).getByRole('button', { name: strings.player.pause })).toBeInTheDocument())
    // Pre-roll: the recording starts at bar 8.
    expect(flute.player().getTime()).toBeCloseTo(flute.timeline[7].startSec, 1)
  })

  it('changes the speed with the slider of the speed panel, from a quarter to double in steps of 0.05, and the panel stays open', async () => {
    const view = await open()

    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.speed(1) }))
    const panel = screen.getByRole('dialog', { name: strings.player.speedLabel })
    const slider = within(panel).getByRole('slider', { name: text.speedHeading })
    expect(slider).toHaveAttribute('min', '0.25')
    expect(slider).toHaveAttribute('max', '2')
    expect(slider).toHaveAttribute('step', '0.05')
    expect(slider).toHaveValue('1')
    fireEvent.change(slider, { target: { value: '0.85' } })

    expect(within(toolbar()).getByRole('button', { name: strings.player.speed(0.85) })).toBeInTheDocument()
    expect(slider).toHaveValue('0.85')
    expect(slider).toHaveAttribute('aria-valuetext', text.speedValueText(0.85))
    expect(panel).toHaveTextContent('0.85×')
    expect(view.player().getRate()).toBe(0.85)
    expect(screen.getByRole('dialog', { name: strings.player.speedLabel })).toBeInTheDocument()
  })

  it('goes back to normal speed with the button of the speed panel', async () => {
    const view = await open()
    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.speed(1) }))
    const panel = screen.getByRole('dialog', { name: strings.player.speedLabel })
    fireEvent.change(within(panel).getByRole('slider', { name: text.speedHeading }), { target: { value: '1.4' } })
    expect(view.player().getRate()).toBe(1.4)

    fireEvent.click(within(panel).getByRole('button', { name: text.backToNormalSpeed }))

    expect(within(toolbar()).getByRole('button', { name: strings.player.speed(1) })).toBeInTheDocument()
    expect(view.player().getRate()).toBe(1)
    expect(screen.getByRole('dialog', { name: strings.player.speedLabel })).toBeInTheDocument()
  })

  it('mutes the music with the speaker button, keeps the volume, and unmutes when the volume slider moves', async () => {
    const view = await open()
    const mute = () => within(toolbar()).getByRole('button', { name: /^(Mute|Unmute) the music$/ })
    const volume = () => within(toolbar()).getByRole('slider', { name: text.musicVolume })
    fireEvent.change(volume(), { target: { value: '0.6' } })
    expect(mute()).toHaveAttribute('aria-label', text.muteMusic)
    expect(mute()).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(mute())

    expect(mute()).toHaveAttribute('aria-label', text.unmuteMusic)
    expect(mute()).toHaveAttribute('aria-pressed', 'true')
    expect(view.player().getVolume()).toBe(0)
    expect(volume()).toHaveValue('0.6')
    expect(volume()).toHaveClass('opacity-35')

    fireEvent.change(volume(), { target: { value: '0.3' } })

    expect(mute()).toHaveAttribute('aria-pressed', 'false')
    expect(view.player().getVolume()).toBe(0.3)
    expect(volume()).not.toHaveClass('opacity-35')
  })

  it('switches the metronome on and chooses its tone', async () => {
    await open()
    const metronome = within(toolbar()).getByRole('switch', { name: text.metronomeSwitch })
    expect(metronome).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(metronome)
    expect(metronome).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.tone('Wood') }))
    const panel = screen.getByRole('dialog', { name: text.toneMenu })
    expect(within(panel).getAllByRole('radio').map((item) => item.textContent)).toEqual(['Wood', 'Click', 'Beep'])
    fireEvent.click(within(panel).getByRole('radio', { name: 'Beep' }))

    expect(within(toolbar()).getByRole('button', { name: text.tone('Beep') })).toBeInTheDocument()
  })

  it('clicks on the beats at the tone chosen once playing', async () => {
    const view = await open('?bar=17')
    fireEvent.click(within(toolbar()).getByRole('switch', { name: text.metronomeSwitch }))
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.tone('Wood') }))
    fireEvent.click(within(screen.getByRole('dialog', { name: text.toneMenu })).getByRole('radio', { name: 'Click' }))

    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40)
    })

    expect(view.synth().scheduled.length).toBeGreaterThan(0)
    expect(view.synth().scheduled.every((click) => click.tone === 'click')).toBe(true)
  })

  it('sets the metronome volume from a slider in the tone menu, and the clicks carry it', async () => {
    const view = await open('?bar=17')
    fireEvent.click(within(toolbar()).getByRole('switch', { name: text.metronomeSwitch }))
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.tone('Wood') }))

    const slider = within(screen.getByRole('dialog', { name: text.toneMenu })).getByRole('slider', { name: text.metronomeVolume })
    expect(slider).toHaveValue('0.8')
    fireEvent.change(slider, { target: { value: '0.3' } })
    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40)
    })

    expect(view.synth().scheduled.length).toBeGreaterThan(0)
    expect(view.synth().scheduled.every((click) => click.volume === 0.3)).toBe(true)
  })

  it('sets the music volume from the slider', async () => {
    const view = await open()

    fireEvent.change(within(toolbar()).getByRole('slider', { name: text.musicVolume }), { target: { value: '0.4' } })

    expect(view.player().getVolume()).toBeCloseTo(0.4)
  })

  it('offers one to four bars as number buttons in the count-in menu, the tempo source and every repeat', async () => {
    const view = await open()

    fireEvent.click(within(toolbar()).getByRole('button', { name: text.countInSettings }))
    const panel = screen.getByRole('dialog', { name: text.countInMenu })
    const bars = within(within(panel).getByRole('radiogroup', { name: text.countInBarsGroup })).getAllByRole('radio')
    // The four numbers and, after them, the word: each button is still named "1 bar" to "4 bars".
    expect(bars.map((item) => item.textContent)).toEqual(['1', '2', '3', '4'])
    expect(bars.map((item) => item.getAttribute('aria-label'))).toEqual(['1 bar', '2 bars', '3 bars', '4 bars'])
    expect(panel).toHaveTextContent(text.countInBarsWord)
    fireEvent.click(within(panel).getByRole('radio', { name: '2 bars' }))
    fireEvent.click(within(panel).getByRole('radio', { name: text.tempoSources['bar-before'] }))
    fireEvent.click(within(panel).getByRole('switch', { name: text.countInEveryRepeat }))

    expect(within(panel).getByRole('radio', { name: '2 bars' })).toHaveAttribute('aria-checked', 'true')
    expect(within(panel).getByRole('radio', { name: text.tempoSources['bar-before'] })).toHaveAttribute('aria-checked', 'true')
    expect(within(panel).getByRole('switch', { name: text.countInEveryRepeat })).toHaveAttribute('aria-checked', 'true')
    expect(within(toolbar()).getByRole('button', { name: text.countIn('2 bars') })).toBeInTheDocument()
    await waitFor(async () => expect((await view.fakes.data.getPiece(CLARK))?.piece.countInBars).toBe(2))
  })

  it('switches the count-in off and on from its button and brings back the chosen length', async () => {
    const view = await open()
    const toggle = () => within(toolbar()).getByRole('button', { name: /^Count-in: / })

    fireEvent.click(within(toolbar()).getByRole('button', { name: text.countInSettings }))
    fireEvent.click(within(screen.getByRole('dialog', { name: text.countInMenu })).getByRole('radio', { name: '3 bars' }))
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(toggle()).toHaveTextContent(text.countIn(text.countInOff))
    await waitFor(async () => expect((await view.fakes.data.getPiece(CLARK))?.piece.countInBars).toBe(0))

    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(toggle()).toHaveTextContent(text.countIn('3 bars'))
    await waitFor(async () => expect((await view.fakes.data.getPiece(CLARK))?.piece.countInBars).toBe(3))
  })

  it('closes a menu with Escape and with a press outside', async () => {
    await open()
    const speed = within(toolbar()).getByRole('button', { name: strings.player.speed(1) })

    fireEvent.click(speed)
    fireEvent.keyDown(screen.getByRole('dialog', { name: strings.player.speedLabel }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: strings.player.speedLabel })).toBeNull()

    fireEvent.click(speed)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: strings.player.speedLabel })).toBeNull()
  })

  it('lays the toolbar out compactly from lg up: rows flow together, a smaller ring, a wide column; below lg the board layout stays', async () => {
    await open()

    const rows = [...toolbar().querySelectorAll(':scope > div > div')]
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.className).toContain('lg:contents')
    expect(toolbar().querySelector('[data-slot="play-ring"] button')?.className).toMatch(/size-\[72px\].*lg:size-12/)
    expect(document.querySelector('main')?.className).toContain('max-w-4xl')
    expect(document.querySelector('main')?.className).toContain('lg:max-w-[1100px]')
  })

  it('has Stems, disabled, with a Soon badge', async () => {
    await open()

    const stems = within(toolbar()).getByRole('button', { name: new RegExp(text.stems) })
    expect(stems).toBeDisabled()
    expect(stems).toHaveTextContent(text.soon)
  })

  it('has touch targets of at least 44 px on its buttons', async () => {
    await open()

    for (const button of within(toolbar()).getAllByRole('button')) {
      expect(button.className, button.textContent ?? button.getAttribute('aria-label') ?? '').toMatch(/min-h-11|size-11|size-\[72px\]|h-11/)
    }
  })

  it('collapses to its handle and opens again, leaving the loop alone', async () => {
    const view = await open()
    await view.user.clear(field())
    await view.user.type(field(), '17-24{Enter}')
    expect(document.querySelector('[data-slot="overview"]')).toBeInTheDocument()

    fireEvent.click(within(toolbar()).getByRole('button', { name: text.collapse }))

    expect(screen.queryByRole('textbox', { name: text.loopRange })).toBeNull()
    expect(document.querySelector('[data-slot="overview"]')).toBeNull()
    expect(screen.queryByRole('button', { name: strings.player.play })).toBeNull()
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.expand }))
    expect(field()).toHaveValue('17–24')
    expect(document.querySelector('[data-slot="overview"]')).toBeInTheDocument()
  })
})

describe('Practice page: the overview strip', () => {
  it('draws the waveform, the loop band and the playhead, and seeks on a press', async () => {
    const view = await open()
    await view.user.clear(field())
    await view.user.type(field(), '17-24{Enter}')
    const strip = screen.getByRole('slider', { name: text.overview })
    strip.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 64, right: 1000, bottom: 64, x: 0, y: 0, toJSON() {} })

    expect(strip.querySelectorAll('[data-slot="wave-bar"]').length).toBeGreaterThan(0)
    expect(strip.querySelector('[data-slot="loop-band"]')).toBeInTheDocument()
    fireEvent.pointerDown(strip, { clientX: 500, clientY: 30 })

    expect(view.player().getTime()).toBeCloseTo(135.5, 0)
    expect(strip.querySelector<HTMLElement>('[data-slot="playhead"]')?.style.left).toBe('50%')
  })

  it('shows no section letters', async () => {
    await open()

    expect(screen.queryByText('Intro')).toBeNull()
  })
})

describe('Practice page: what the piece remembers', () => {
  it('opens on the loop, the speed and the metronome of the last visit', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const first = await open('', fakes)
    await first.user.clear(field())
    await first.user.type(field(), '17-24{Enter}')
    fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.speed(1) }))
    fireEvent.change(screen.getByRole('slider', { name: text.speedHeading }), { target: { value: '0.85' } })
    fireEvent.click(within(toolbar()).getByRole('switch', { name: text.metronomeSwitch }))
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.tone('Wood') }))
    fireEvent.click(within(screen.getByRole('dialog', { name: text.toneMenu })).getByRole('radio', { name: 'Beep' }))
    fireEvent.change(within(screen.getByRole('dialog', { name: text.toneMenu })).getByRole('slider', { name: text.metronomeVolume }), { target: { value: '0.35' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    first.unmount()

    await open('', fakes)

    expect(field()).toHaveValue('17–24')
    expect(within(toolbar()).getByRole('button', { name: strings.player.speed(0.85) })).toBeInTheDocument()
    expect(within(toolbar()).getByRole('switch', { name: text.metronomeSwitch })).toHaveAttribute('aria-checked', 'true')
    expect(within(toolbar()).getByRole('button', { name: text.tone('Beep') })).toBeInTheDocument()
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.tone('Beep') }))
    expect(within(screen.getByRole('dialog', { name: text.toneMenu })).getByRole('slider', { name: text.metronomeVolume })).toHaveValue('0.35')
  })
})

describe('Practice page: the Loop button shows and hides the loop', () => {
  const loopButton = () => within(toolbar()).getByRole('button', { name: text.loop })
  const SHOWN = { tints: 8, handles: 2, band: true }
  const HIDDEN = { tints: 0, handles: 0, band: false }

  async function withLoop(query = '', fakes?: Fakes) {
    const view = await open(query, fakes)
    await view.user.clear(field())
    await view.user.type(field(), '17-24{Enter}')
    return view
  }

  it('lights up with the loop and shows its tint, both handles and the band on the strip', async () => {
    await withLoop()

    expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
    expect(marks()).toEqual(SHOWN)
  })

  it('hides the tint, the handles and the band when the lit button is pressed, keeps the range in the field, and brings them back, with the seek to the loop start, when pressed again', async () => {
    const view = await withLoop()
    act(() => view.player().seek(view.timeline[28].startSec))

    fireEvent.click(loopButton())

    expect(loopButton()).toHaveAttribute('aria-pressed', 'false')
    expect(marks()).toEqual(HIDDEN)
    expect(screen.queryByText(text.loopBand('17–24'))).toBeNull()
    expect(field()).toHaveValue('17–24')

    fireEvent.click(loopButton())

    expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
    expect(marks()).toEqual(SHOWN)
    expect(field()).toHaveValue('17–24')
    expect(view.player().getTime()).toBeCloseTo(view.timeline[24].startSec, 1)
  })

  it('hides the marks when the position moves outside the loop by a strip press, and shows them again with the button', async () => {
    const view = await withLoop()
    const strip = screen.getByRole('slider', { name: text.overview })
    strip.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 64, right: 1000, bottom: 64, x: 0, y: 0, toJSON() {} })

    fireEvent.pointerDown(strip, { clientX: 800, clientY: 30 })

    await waitFor(() => expect(marks()).toEqual(HIDDEN))
    fireEvent.click(loopButton())
    expect(marks()).toEqual(SHOWN)
    expect(view.player().getTime()).toBeCloseTo(view.timeline[24].startSec, 1)
  })

  it('opens with the marks hidden when ?bar= is outside the remembered loop', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const first = await withLoop('', fakes)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    first.unmount()

    await open('?bar=40', fakes)

    expect(marks()).toEqual(HIDDEN)
    expect(field()).toHaveValue('17–24')
  })

  it('remembers that looping was off: the range comes back in the field and the marks stay hidden', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const first = await withLoop('', fakes)
    fireEvent.click(loopButton())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    first.unmount()

    await open('', fakes)

    expect(loopButton()).toHaveAttribute('aria-pressed', 'false')
    expect(marks()).toEqual(HIDDEN)
    expect(field()).toHaveValue('17–24')
  })

  it('remembers that looping was on: the marks are shown on reopening', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const first = await withLoop('', fakes)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    first.unmount()

    await open('', fakes)

    expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
    expect(marks()).toEqual(SHOWN)
  })

  describe('a long press on the score', () => {
    it('discards a loop that is on and starts picking: the marks are gone, the start is tinted, the hint asks for the last bar', async () => {
      const view = await withLoop()

      await longPressBar(view, 30)

      expect(marks()).toEqual(HIDDEN)
      expect(field()).toHaveValue('')
      expect(document.querySelector('[data-slot="range-pending"]')).toHaveAttribute('data-bar', '30')
      expect(screen.getByText(text.pickHint)).toBeInTheDocument()
    })

    it('discards a loop that is off and starts picking in the same way', async () => {
      const view = await withLoop()
      fireEvent.click(loopButton())

      await longPressBar(view, 30)

      expect(marks()).toEqual(HIDDEN)
      expect(field()).toHaveValue('')
      expect(document.querySelector('[data-slot="range-pending"]')).toHaveAttribute('data-bar', '30')
      expect(screen.getByText(text.pickHint)).toBeInTheDocument()
    })

    it('sets the new loop, with looping on, when its last bar is tapped', async () => {
      const view = await withLoop()
      fireEvent.click(loopButton())

      await longPressBar(view, 30)
      tapBar(view, 33)

      expect(field()).toHaveValue('30–33')
      expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
      expect(marks()).toEqual({ tints: 4, handles: 2, band: true })
    })

    it('brings the previous loop back as it was on Escape: on stays on, without a seek', async () => {
      const view = await withLoop()
      act(() => view.player().seek(view.timeline[26].startSec))
      const time = view.player().getTime()
      await longPressBar(view, 30)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(document.querySelector('[data-slot="range-pending"]')).toBeNull()
      expect(screen.queryByText(text.pickHint)).toBeNull()
      expect(field()).toHaveValue('17–24')
      expect(loopButton()).toHaveAttribute('aria-pressed', 'true')
      expect(marks()).toEqual(SHOWN)
      expect(view.player().getTime()).toBe(time)
    })

    it('brings the previous loop back as it was on Escape: off stays off, with the range in the field', async () => {
      const view = await withLoop()
      fireEvent.click(loopButton())
      await longPressBar(view, 30)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(field()).toHaveValue('17–24')
      expect(loopButton()).toHaveAttribute('aria-pressed', 'false')
      expect(marks()).toEqual(HIDDEN)
    })

    it('brings the previous loop back when the pick is cancelled with a tap off the bars', async () => {
      const view = await withLoop()
      await longPressBar(view, 30)

      const el = page(boxOf(view, 30).pageIndex)
      fireEvent.pointerDown(el, { clientX: 1, clientY: 1 })
      fireEvent.pointerUp(el, { clientX: 1, clientY: 1 })

      expect(field()).toHaveValue('17–24')
      expect(marks()).toEqual(SHOWN)
    })

    it('replaces the previous loop with a one-bar loop', async () => {
      const view = await withLoop()
      await longPressBar(view, 30)

      tapBar(view, 30)

      expect(field()).toHaveValue('30–30')
    })
  })
})
