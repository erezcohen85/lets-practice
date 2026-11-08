import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expandPlayOrder } from '@/domain/playOrder'
import { unmatchedSlots } from '@/domain/renumber'
import { type PieceMap, type TimingLayer } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { barWithPass, strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// UX part 10: a bar line too many (or too few) on the waveform makes every later bar one number off. Delete and Add on
// the waveform follow the "Renumber the bars after" switch (Shift does the other one); the last bar a ripple delete
// leaves without a time is filled from the recording, and the status line says what moved.

const CLARK = 'piece-clark-county'
const text = strings.editor
const COLUMN = 1240 + 2 * 16
const BAR = 30

async function open(fakes: Fakes = createFakes({ seed: 'demo' })) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const before = structuredClone((await fakes.data.getPieceMap(CLARK))!)
  const detail = (await fakes.data.getPiece(CLARK))!
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${detail.parts[0].id}`, { fakes })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 10_000 })
  return { ...view, fakes, before }
}

const status = () => document.querySelector<HTMLElement>('[data-slot="editor-status"]')!
const undoButton = () => screen.getByRole('button', { name: new RegExp(`^(${strings.history.undo}|${strings.history.nothingToUndo})`) })
const stored = async (fakes: Fakes) => (await fakes.data.getPieceMap(CLARK))!

/** Selects the locator of the bar by clicking its box on the score (Move mode), so Delete acts on it. */
function select(map: PieceMap, bar: number) {
  const box = map.pages[0].bars.find((candidate) => candidate.bar === bar)!
  const el = document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${box.pageIndex}"]`)!
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1240, height: 1754, right: 1240, bottom: 1754, x: 0, y: 0, toJSON() {} })
  fireEvent.pointerDown(el, { clientX: box.x + box.w / 2, clientY: box.y + 50 })
  fireEvent.pointerUp(el, { clientX: box.x + box.w / 2, clientY: box.y + 50 })
}

/** The bar a locator at this time sits on, as a label. */
const labelAt = (timing: TimingLayer, timeSec: number) => {
  const found = timing.locators.find((l) => l.timeSec === timeSec)
  return found === undefined ? undefined : barWithPass(String(found.bar), found.passIndex)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Delete on the waveform with the Renumber switch on', () => {
  it('moves every later bar line one bar back, fills the last bar from the recording, leaves the PDF alone and says so', async () => {
    const { user, fakes, before } = await open()
    const slots = expandPlayOrder(before.timing.playOrder, before.timing.barCount)
    const at = slots.findIndex((s) => s.bar === BAR && s.passIndex === 0)
    const last = slots[slots.length - 1]
    const removed = before.timing.locators.find((l) => l.bar === BAR && l.passIndex === 0)!
    const next = before.timing.locators.find((l) => l.bar === slots[at + 1].bar && l.passIndex === slots[at + 1].passIndex)!

    select(before, BAR)
    await user.keyboard('{Delete}')

    await waitFor(async () => expect(unmatchedSlots((await stored(fakes)).timing)).toHaveLength(0))
    const after = (await stored(fakes)).timing
    expect(after.locators).toHaveLength(before.timing.locators.length)
    expect(after.locators.some((l) => l.timeSec === removed.timeSec)).toBe(false)
    expect(labelAt(after, next.timeSec)).toBe(barWithPass(String(BAR), 0))
    expect(after.locators.find((l) => l.bar === last.bar && l.passIndex === last.passIndex)).toMatchObject({ confirmed: false })
    expect((await stored(fakes)).pages).toEqual(before.pages)
    expect(status()).toHaveTextContent(
      text.status.shifted(
        { first: barWithPass(String(next.bar), next.passIndex), last: barWithPass(String(last.bar), last.passIndex), count: slots.length - at - 1, direction: 'back' },
        { first: barWithPass(String(last.bar), last.passIndex), last: barWithPass(String(last.bar), last.passIndex), count: 1 },
      ),
    )
  })

  it('is two undo steps, the fill and then the delete (the history has no merged step)', async () => {
    const { user, fakes, before } = await open()
    select(before, BAR)
    await user.keyboard('{Delete}')
    await waitFor(() => expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: fill the empty bars`))

    await user.click(undoButton())
    await waitFor(async () => expect(unmatchedSlots((await stored(fakes)).timing)).toHaveLength(1))
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: delete locator for bar ${BAR}`)
    expect(status()).not.toHaveTextContent(/moved one bar/)

    await user.click(undoButton())
    await waitFor(async () => expect((await stored(fakes)).timing).toEqual(before.timing))
  })

  it('Shift+Delete only clears that bar: nothing moves and the fill does not put it back', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const fill = vi.spyOn(fakes.processor, 'fillEmptyBars')
    const { user, before } = await open(fakes)
    select(before, BAR)

    await user.keyboard('{Shift>}{Delete}{/Shift}')

    await waitFor(async () => expect((await stored(fakes)).timing.locators).toHaveLength(before.timing.locators.length - 1))
    expect(unmatchedSlots((await stored(fakes)).timing)).toMatchObject([{ bar: BAR, passIndex: 0 }])
    expect(fill).not.toHaveBeenCalled()
    expect(status()).not.toHaveTextContent(/moved one bar/)
    expect(status()).toHaveTextContent(text.status.unmatched(1))
  })
})

describe('Delete on the waveform with the Renumber switch off', () => {
  it('only clears that bar and does not fill it; Shift+Delete moves the later bars back and fills the last', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const fill = vi.spyOn(fakes.processor, 'fillEmptyBars')
    const { user, before } = await open(fakes)
    await user.click(screen.getByRole('switch', { name: text.renumber }))
    expect(screen.getByRole('switch', { name: text.renumber })).not.toBeChecked()
    select(before, BAR)

    await user.keyboard('{Delete}')

    await waitFor(async () => expect((await stored(fakes)).timing.locators).toHaveLength(before.timing.locators.length - 1))
    expect(fill).not.toHaveBeenCalled()
    expect(status()).toHaveTextContent(text.status.unmatched(1))

    await user.click(undoButton())
    await waitFor(async () => expect((await stored(fakes)).timing).toEqual(before.timing))
    select(before, BAR)
    await user.keyboard('{Shift>}{Delete}{/Shift}')

    await waitFor(() => expect(fill).toHaveBeenCalledTimes(1))
    await waitFor(async () => expect(unmatchedSlots((await stored(fakes)).timing)).toHaveLength(0))
    expect(status()).toHaveTextContent(/moved one bar back; bar .* filled from the recording\./)
  })
})
