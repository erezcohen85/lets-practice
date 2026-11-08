import { act, fireEvent, screen, within } from '@testing-library/react'
import { barNamesOf } from '@/domain/barNames'
import { buildTimeline } from '@/domain/tempo'
import { createFakes, type Fakes } from '@/lib/fakes'
import { MID_PICKUP_SPEC } from '@/lib/fakes/syntheticPiece'
import { strings } from '@/strings'
import { turnOnPieceEditing } from '@/test/pieceChange'
import { renderWithApp } from '@/test/render'

// The guard of Task 15: a piece whose internal bar 7 is a short bar with no number of its own. Every screen that shows a bar reads
//   internal: 1 2 3 4 5 6  7   8 9 10 ...
//   label:    1 2 3 4 5 6  p7  7 8 9  ...
// and a label typed in the other direction reaches the same internal bars.
const MARCH = 'piece-march'
const PAGE_WIDTH = 1240
const COLUMN = PAGE_WIDTH + 2 * 16
const names = barNamesOf(MID_PICKUP_SPEC.midPickups?.map((pickup) => ({ ...pickup, unnumbered: true as const })))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** The number drawn on the score for an internal bar. */
const scoreNumber = (bar: number) => document.querySelector(`[data-slot="bar-box"][data-bar="${bar}"] [data-slot="bar-number"]`)?.textContent

async function partIdOf(fakes: Fakes) {
  return (await fakes.data.getPiece(MARCH))!.parts[0].id
}

describe('the seeded piece', () => {
  it('has a short bar with no number at internal bar 7, kept in the saved map as a flag', async () => {
    const map = (await createFakes({ seed: 'demo-midpickup' }).data.getPieceMap(MARCH))!

    expect(map.timing.shortBars).toEqual([{ bar: 7, units: 2, unnumbered: true }])
    expect(map.timing.barCount).toBe(24)
    expect(names.label(7)).toBe('p7')
  })
})

describe('Practice on a piece with a pickup in the middle', () => {
  async function open(query = '') {
    const fakes = createFakes({ seed: 'demo-midpickup' })
    const partId = await partIdOf(fakes)
    const map = (await fakes.data.getPieceMap(MARCH))!
    const view = renderWithApp(`/pieces/${MARCH}/practice?part=${partId}${query}`, { fakes, playerSec: 40 })
    await screen.findAllByRole('img', { name: /^Page \d of 2$/ })
    await screen.findByRole('region', { name: strings.practice.toolbar })
    return { ...view, fakes, map, timeline: buildTimeline(map.timing, 40) }
  }

  it('numbers the score at, before and after the pickup: 6, p7, 7', async () => {
    await open()

    expect([5, 6, 7, 8, 9].map(scoreNumber)).toEqual(['5', '6', 'p7', '7', '8'])
  })

  it('names the bar the playhead is on in the position: Bar p7 on the pickup, Bar 7 on the bar after it', async () => {
    await open('&bar=7')
    expect(within(screen.getByRole('region', { name: strings.practice.toolbar })).getByText('Bar p7')).toBeInTheDocument()
  })

  it('reads the bar after the pickup as Bar 7', async () => {
    await open('&bar=8')
    expect(within(screen.getByRole('region', { name: strings.practice.toolbar })).getByText('Bar 7')).toBeInTheDocument()
  })

  it('takes a typed loop p7-9 as the internal bars 7 to 10, and writes it back as p7–9', async () => {
    const view = await open()
    const field = screen.getByRole('textbox', { name: strings.practice.loopRange })
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'p7-9' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(screen.getByRole('textbox', { name: strings.practice.loopRange })).toHaveValue('p7–9')
    const start = screen.getByRole('slider', { name: strings.practice.loopStart })
    const end = screen.getByRole('slider', { name: strings.practice.loopEnd })
    // the handles carry the internal bar and say its label
    expect([start.getAttribute('aria-valuenow'), start.getAttribute('aria-valuetext')]).toEqual(['7', strings.practice.bar('p7')])
    expect([end.getAttribute('aria-valuenow'), end.getAttribute('aria-valuetext')]).toEqual(['10', strings.practice.bar('9')])
    const first = view.timeline.findIndex((played) => played.slot.bar === 7)
    expect(view.timeline[first].slot.bar).toBe(7)
  })

  it('refuses a loop typed with a pickup that does not exist, saying why', async () => {
    await open()
    const field = screen.getByRole('textbox', { name: strings.practice.loopRange })
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'p9-12' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(screen.getByRole('alert')).toHaveTextContent(strings.practice.rangeErrors['unknown-bar'])
  })
})

describe('the Editor on a piece with a pickup in the middle', () => {
  async function open(query = '') {
    const fakes = createFakes({ seed: 'demo-midpickup' })
    const partId = await partIdOf(fakes)
    const view = renderWithApp(`/pieces/${MARCH}/edit?part=${partId}${query}`, { fakes, playerSec: 40 })
    await screen.findAllByRole('img', { name: /^Page \d of 2$/ })
    await screen.findByRole('timer', { name: strings.dock.timeLabel })
    return { ...view, fakes }
  }

  describe('the Pickup bar switch on the Edit bar lines panel', () => {
    const toggle = () => screen.getByRole('switch', { name: strings.editor.pickupBar.label })

    it('shows the selected bar, and with Edit piece on makes it a p bar and back', async () => {
      const { user } = await open('&bar=12')
      expect(toggle()).not.toBeChecked()
      expect(scoreNumber(12)).toBe('11')

      await turnOnPieceEditing(user)
      await user.click(toggle())
      expect(toggle()).toBeChecked()
      expect(scoreNumber(12)).toBe('p11')
      expect(scoreNumber(13)).toBe('11')

      await user.click(toggle())
      expect(toggle()).not.toBeChecked()
      expect(scoreNumber(12)).toBe('11')
    })

    it('shows a bar that is a pickup as on', async () => {
      await open('&bar=7')
      expect(toggle()).toBeChecked()
    })

    it('with Edit piece off asks to turn it on, and changes nothing yet', async () => {
      const { user } = await open('&bar=12')
      await user.click(toggle())
      expect(await screen.findByRole('alertdialog', { name: strings.editor.pieceEditing.warningTitle })).toBeInTheDocument()
      expect(scoreNumber(12)).toBe('11')
    })

    it('says why when the bar cannot be one', async () => {
      const { user } = await open('&bar=8')
      await turnOnPieceEditing(user)
      await user.click(toggle())
      expect(toggle()).not.toBeChecked()
      expect(screen.getByText(strings.editor.refusals['next-to-pickup'])).toBeInTheDocument()
    })
  })

  it('numbers the score 6, p7, 7 and the page line covers the pickup', async () => {
    await open()

    expect([6, 7, 8].map(scoreNumber)).toEqual(['6', 'p7', '7'])
    // the first page holds internal bars 1-16: labels 1 to 15
    expect(screen.getByText(strings.score.pageLabel(1, 2, '1', '15'))).toBeInTheDocument()
  })

  it('labels the locator of the pickup on the waveform p7, with the locators before and after it 6 and 7', async () => {
    await open('&bar=7')
    const label = (bar: number) => document.querySelector(`[data-slot="dock-locator"][data-bar="${bar}"][data-pass="0"]`)?.textContent
    expect(await screen.findByLabelText(strings.dock.barChipLabel)).toHaveTextContent('Bar p7')
    expect([6, 7, 8].map(label)).toEqual(['6', 'p7', '7'])
  })

  it('shows the Review Queue cards by label: the flagged internal bar 7 is Bar p7, and internal 12 is Bar 11', async () => {
    await open()
    const queue = screen.getByRole('complementary', { name: strings.review.queue.title })

    expect(within(queue).getByRole('button', { name: /^Bar p7\b/ })).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: /^Bar 11\b/ })).toBeInTheDocument()
    expect(within(queue).queryByRole('button', { name: /^Bar 12\b/ })).toBeNull()
  })

  it('opens Structure on the pickup: Pickup bars lists "Before bar 7", the play order runs 1 to 23, and Edit as text writes the pickups line', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: strings.structure.title }))
    const body = () => document.querySelector('[data-slot="structure-body"]') as HTMLElement

    const rows = body().querySelectorAll('[data-slot="pickup-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent(`${strings.structure.pickup.before} 7`)
    expect(within(body()).getByText(strings.structure.pickup.count(1))).toBeInTheDocument()
    expect(within(body()).getByText('23 bars + pickup')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: strings.structure.sections.playOrder }))
    expect((within(body()).getByLabelText(strings.structure.playOrder.rowFrom(1)) as HTMLInputElement).value).toBe('1')
    expect((within(body()).getByLabelText(strings.structure.playOrder.rowTo(1)) as HTMLInputElement).value).toBe('23')

    await user.click(screen.getByRole('switch', { name: strings.structure.editAsText }))
    const box = within(body()).getByRole('textbox', { name: strings.structure.text.label }) as HTMLTextAreaElement
    expect(box.value).toContain('play order: 1-end')
    expect(box.value).toContain('pickups: p7 2/4')
  })
})
