import { selectedLocators } from '@/test/dockSelection'
import { screen, waitFor, within } from '@testing-library/react'
import { formatClock } from '@/components/waveform/dockLayout'
import { type BoxFlag } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { type FakePlayer } from '@/lib/fakes/fakePlayer'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// The Review Queue inside the real Editor on the demo piece (task 6.6): what it shows, what N and the cards do to the
// rest of the page, and what a saved action does to the hub.

const CLARK = 'piece-clark-county'
const text = strings.review
const PAGE_WIDTH = 1240
const COLUMN = PAGE_WIDTH + 2 * 16

async function open(fakes: Fakes = createFakes({ seed: 'demo' })) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const detail = (await fakes.data.getPiece(CLARK))!
  const partId = detail.parts[0].id
  const players: FakePlayer[] = []
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${partId}`, { fakes, playerSec: 271, onMedia: ({ player }) => player !== undefined && players.push(player) })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  await screen.findByRole('timer', { name: strings.dock.timeLabel })
  return { ...view, fakes, partId, player: () => players.at(-1)! }
}

const card = (bar: number) => screen.getByRole('button', { name: new RegExp(`^Bar ${bar}\\b`) })
const queue = () => screen.getByRole('complementary', { name: text.queue.title })
const stored = (fakes: Fakes, bar: number) => fakes.store.maps.get(CLARK)!.timing.locators.find((l) => l.bar === bar && l.passIndex === 0)!
const clock = () => screen.getByRole('timer', { name: strings.dock.timeLabel })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the Review Queue in the Editor', () => {
  it('counts the board: 7 of 12 checked for the clarinet, with a card for each of the twelve', async () => {
    await open()

    expect(within(queue()).getByText(text.queue.checked(7, 12))).toBeInTheDocument()
    expect(within(queue()).getAllByRole('listitem')).toHaveLength(12)
    expect(within(queue()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '7')
    expect(card(6)).toHaveTextContent('Crowded')
    expect(card(28)).toHaveTextContent('Explained by score')
    expect(card(41)).toHaveTextContent('Stretched 1.4x')
  })

  it('opens a card on a click: selects its slot, moves the playhead there and shows its page', async () => {
    const { user, fakes } = await open()

    await user.click(card(41))

    expect(card(41)).toHaveAttribute('aria-expanded', 'true')
    expect(selectedLocators()).toEqual(['41:0'])
    expect(clock()).toHaveTextContent(formatClock(stored(fakes, 41).timeSec))
    // Bars 33-48 are on the third page of the demo score.
    expect(screen.getByText(strings.score.pageLabel(3, 4, '33', '48'))).toBeInTheDocument()
  })

  // Erez, 2026-11-06: after opening a bar from a card, Space plays from that bar's start (it used to press the card again).
  it('plays from the start of the opened bar on Space after a click on its card', async () => {
    const { user, fakes, player } = await open()
    await user.click(card(41))
    expect(card(41)).not.toHaveFocus()

    await user.keyboard(' ')

    expect(card(41)).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(player().isPlaying()).toBe(true))
    expect(player().getTime()).toBeCloseTo(stored(fakes, 41).timeSec, 3)
  })

  it('keeps focus on a card opened from the keyboard, so the list is not left', async () => {
    const { user } = await open()
    card(41).focus()
    await user.keyboard('{Enter}')
    expect(card(41)).toHaveAttribute('aria-expanded', 'true')
    expect(card(41)).toHaveFocus()
  })

  it('jumps to the opened bar and keeps playing when the recording is already playing', async () => {
    const { user, fakes, player } = await open()
    await user.click(card(41))
    await user.keyboard(' ')
    await waitFor(() => expect(player().isPlaying()).toBe(true))
    await user.click(card(43))
    expect(player().isPlaying()).toBe(true)
    expect(player().getTime()).toBeCloseTo(stored(fakes, 43).timeSec, 3)
  })

  it('moves the playhead to the bar locator when a box flag card is opened', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const detail = (await fakes.data.getPiece(CLARK))!
    const stored20 = stored(fakes, 20)
    const map = fakes.store.maps.get(CLARK)!
    const page = map.pages.get(detail.parts[0].id)!
    map.pages.set(detail.parts[0].id, { ...page, boxFlags: [{ bar: 20, verdict: 'two_bars', note: 'a bar line in the middle', suggestedX: null }] })
    const { user } = await open(fakes)

    await user.click(card(20))

    expect(selectedLocators()).toEqual(['20:0'])
    expect(clock()).toHaveTextContent(formatClock(stored20.timeSec))
  })

  describe('Advanced Reading moves', () => {
    // Sousa Flutes line 18 (8.22): the read added a missed bar line to the line of bars 9-12 (laid out here as 9 | 10 | 11 | 12),
    // which moved boxes 10, 11 and 12, each with its own flag. Before: 10 was 470.67-876.67, 11 876.67-970, 12 970-1116.
    const BEFORE = [{ x: 470.67, w: 406 }, { x: 876.67, w: 93.33 }, { x: 970, w: 146 }]

    async function openWithMoves(extraFlags: BoxFlag[] = []) {
      const fakes = createFakes({ seed: 'demo' })
      const detail = (await fakes.data.getPiece(CLARK))!
      const partId = detail.parts[0].id
      const map = fakes.store.maps.get(CLARK)!
      const page = map.pages.get(partId)!
      const now = new Map([[9, { x: 100, w: 370.67 }], [10, { x: 470.67, w: 251.83 }], [11, { x: 722.5, w: 154.17 }], [12, { x: 876.67, w: 239.33 }]])
      map.pages.set(partId, {
        ...page,
        bars: page.bars.map((box) => (now.has(box.bar) ? { ...box, ...now.get(box.bar)! } : box)),
        boxFlags: [
          ...BEFORE.map((previous, i): BoxFlag => ({ bar: 10 + i, verdict: 'read_moved', note: 'Advanced Reading moved this bar.', suggestedX: null, previous })),
          ...extraFlags,
        ],
      })
      return { ...(await open(fakes)), partId }
    }

    const put = () => screen.getByRole('button', { name: text.queue.putBack })
    const boxCards = (bars: number[]) => bars.map((bar) => screen.queryByRole('button', { name: new RegExp(`^Bar ${bar}\\b`) }))

    it('Put back line restores the three boxes in one step, and one Undo brings the three flags back', async () => {
      const { user, fakes, partId } = await openWithMoves()
      expect(boxCards([10, 11, 12]).every((button) => button !== null)).toBe(true)

      await user.click(card(10))
      await user.click(put())

      expect(boxCards([10, 11, 12])).toEqual([null, null, null])
      await waitFor(() => {
        const saved = fakes.store.maps.get(CLARK)!.pages.get(partId)!
        expect([10, 11, 12].map((bar) => saved.bars.find((box) => box.bar === bar)!)).toMatchObject(BEFORE)
        expect(saved.boxFlags).toBeUndefined()
      })

      await user.click(screen.getByRole('button', { name: new RegExp(`^${strings.history.undo}: resolve the box flag on bar 10`) }))

      expect(boxCards([10, 11, 12]).every((button) => button !== null)).toBe(true)
    })

    it('says so in the hint line when the line cannot go back, and keeps the cards', async () => {
      const { user } = await openWithMoves([{ bar: 9, verdict: 'read_moved', note: 'n', suggestedX: null, previous: { x: 100, w: 0 } }])

      await user.click(card(10))
      await user.click(put())

      expect(await screen.findByText(text.queue.putBackRefused)).toBeInTheDocument()
      expect(boxCards([9, 10, 11, 12]).every((button) => button !== null)).toBe(true)
    })

    it('offers only Dismiss on a flag for a changed bar count', async () => {
      const { user } = await openWithMoves([{ bar: 13, verdict: 'read_count', note: 'Advanced Reading read 3 bars on this line; the first read had 4.', suggestedX: null }])

      await user.click(card(13))

      expect(screen.queryByRole('button', { name: text.queue.putBack })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: text.queue.dismissFlag })).toBeInTheDocument()
    })
  })

  it('goes to the next problem on N: the first open one, then the next, and round again', async () => {
    const { user, fakes } = await open()

    await user.keyboard('n')
    expect(card(41)).toHaveAttribute('aria-expanded', 'true')
    expect(clock()).toHaveTextContent(formatClock(stored(fakes, 41).timeSec))

    await user.keyboard('n')
    expect(card(43)).toHaveAttribute('aria-expanded', 'true')
    expect(card(41)).toHaveAttribute('aria-expanded', 'false')
    expect(selectedLocators()).toEqual(['43:0'])
    expect(clock()).toHaveTextContent(formatClock(stored(fakes, 43).timeSec))

    await user.keyboard('nnn')
    expect(card(60)).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('n')
    expect(card(41)).toHaveAttribute('aria-expanded', 'true')
  })

  it('saves Sounds right at once: the locator is confirmed and checked in the store, and the count moves', async () => {
    const { user, fakes } = await open()
    expect(stored(fakes, 41).checked).toBeFalsy()

    await user.click(card(41))
    await user.click(within(queue()).getByRole('button', { name: text.queue.soundsRight }))

    expect(within(queue()).getByText(text.queue.checked(8, 12))).toBeInTheDocument()
    await waitFor(() => expect(stored(fakes, 41)).toMatchObject({ checked: true, confirmed: true }))
    // One step in the history: undo takes it back.
    await user.click(screen.getByRole('button', { name: new RegExp(`^${strings.history.undo}: mark bar 41 as sounds right`) }))
    expect(within(queue()).getByText(text.queue.checked(7, 12))).toBeInTheDocument()
    await waitFor(() => expect(stored(fakes, 41).checked).toBeFalsy())
  })

  it('shows the new count on the piece hub after an action', async () => {
    const { user, router } = await open()
    await user.click(card(41))
    await user.click(within(queue()).getByRole('button', { name: text.queue.soundsRight }))
    await waitFor(() => expect(within(queue()).getByText(text.queue.checked(8, 12))).toBeInTheDocument())

    await user.click(screen.getByRole('link', { name: strings.editor.pieceHub }))

    // The twelve shared items plus Trumpet's bar-count problem: 8 of 13 now.
    expect(await screen.findByText(strings.hub.reviewTitle(8, 13))).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/pieces/${CLARK}`)
  })
})
