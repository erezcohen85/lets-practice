import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expandPlayOrder } from '@/domain/playOrder'
import { unmatchedSlots } from '@/domain/renumber'
import { type Locator, type PageLayer, type TimingLayer } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { confirmPieceChange, turnOnPieceEditing } from '@/test/pieceChange'
import { renderWithApp } from '@/test/render'
import { makeRoomForRepeat } from '@/test/roomForRepeat'

// Phase 5 checkpoints (task 5.7): the real EditorPage on the demo piece, driven through the UI, judged on what the
// fake store holds and on what the screen says.

const CLARK = 'piece-clark-county'
const text = strings.editor
const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
// One page wide at zoom 1 (the scroll container minus 16 px of padding each side): one image pixel is one screen pixel.
const COLUMN = PAGE_WIDTH + 2 * 16

// The fill of empty bars is off here (the processor cannot fit them): these checks walk the Realign that follows an edit.
async function open(options: { roomForRepeat?: boolean } = {}) {
  const fakes = createFakes({ seed: 'demo' })
  if (options.roomForRepeat === true) makeRoomForRepeat(fakes, CLARK)
  vi.spyOn(fakes.processor, 'fillEmptyBars').mockResolvedValue(null)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const stored = fakes.store.maps.get(CLARK)!
  const original = structuredClone({ timing: stored.timing, pages: [...stored.pages.values()] })
  const detail = (await fakes.data.getPiece(CLARK))!
  const partId = detail.parts[0].id
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${partId}`, { fakes })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  return { ...view, fakes, original, partId, clarinet: original.pages.find((layer) => layer.partId === partId)! }
}

const page = (index: number) => {
  const el = document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, right: PAGE_WIDTH, bottom: PAGE_HEIGHT, x: 0, y: 0, toJSON() {} })
  return el
}
const boxes = () => document.querySelectorAll('[data-slot="bar-box"]')
const status = () => document.querySelector<HTMLElement>('[data-slot="editor-status"]')!
const undoButton = () => screen.getByRole('button', { name: new RegExp(`^(${strings.history.undo}|${strings.history.nothingToUndo})`) })
const timingOf = (fakes: Fakes): TimingLayer => fakes.store.maps.get(CLARK)!.timing
const pagesOf = (fakes: Fakes): PageLayer[] => [...fakes.store.maps.get(CLARK)!.pages.values()]
const keyOf = (locator: Locator) => `${locator.bar}:${locator.passIndex}`
const byKey = (locators: Locator[]) => new Map(locators.map((locator) => [keyOf(locator), locator]))

function click(el: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y })
  fireEvent.pointerUp(el, { clientX: x, clientY: y })
}

type User = Awaited<ReturnType<typeof open>>['user']

/** Add mode, a click in the middle of Clarinet's bar 12: the part gets 65 boxes and its later boxes renumber. */
async function splitClarinetBar12(user: User, clarinet: PageLayer) {
  await user.click(screen.getByRole('button', { name: text.modes.add }))
  const box = clarinet.bars[11]
  expect(box.bar).toBe(12)
  click(page(box.pageIndex), box.x + box.w / 2, box.y + 50)
  await waitFor(() => expect(boxes()).toHaveLength(65))
}

function structurePanel() {
  return screen.getByRole('region', { name: strings.structure.title })
}

/** Structure > Bars: "Insert a bar after bar 12" with the Renumber switch as it is (on). */
async function insertBarAfter12(user: User) {
  await turnOnPieceEditing(user)
  expect(screen.getAllByRole('switch', { name: text.renumber })[0]).toBeChecked()
  await user.click(screen.getByRole('button', { name: strings.structure.title }))
  const field = within(structurePanel()).getByLabelText(strings.structure.bars.insertField)
  await user.clear(field)
  await user.type(field, '12')
  await user.click(within(structurePanel()).getByRole('button', { name: strings.structure.bars.insertApply }))
  await confirmPieceChange(user)
  await waitFor(() => expect(within(structurePanel()).getByText(strings.structure.bars.count(65))).toBeInTheDocument())
}

/** Lets the fake realign job run through its stages: one read a second, until the button stops saying "Realigning". */
async function finishRealign() {
  for (let i = 0; i < 10 && screen.queryByRole('button', { name: text.status.realigning }) !== null; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
  }
}

async function realign() {
  fireEvent.click(within(status()).getByRole('button', { name: text.status.realign }))
  await screen.findByRole('button', { name: text.status.realigning })
  await finishRealign()
  await waitFor(() => expect(screen.queryByRole('button', { name: text.status.realign })).toBeNull())
}

/** Structure > Play order > Edit as text, with the play order line replaced. */
async function setPlayOrderText(user: User, line: string) {
  await turnOnPieceEditing(user)
  await user.click(screen.getByRole('button', { name: strings.structure.title }))
  await user.click(screen.getByRole('switch', { name: strings.structure.editAsText }))
  const textbox = screen.getByRole('textbox', { name: strings.structure.text.label }) as HTMLTextAreaElement
  fireEvent.change(textbox, { target: { value: textbox.value.replace(/^play order:.*$/m, line) } })
  await user.click(screen.getByRole('button', { name: strings.structure.apply }))
}

/** Presses Undo until it is disabled, and checks that it took exactly `steps` presses. */
async function undoAll(user: User, steps: number) {
  let presses = 0
  while (!(undoButton() as HTMLButtonElement).disabled && presses < steps + 2) {
    await user.click(undoButton())
    presses++
  }
  expect(presses).toBe(steps)
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 5 checkpoint 1: a bar line, then a bar in the piece, then Realign', () => {
  it('splits Clarinet bar 12, inserts a bar after bar 12 with ripple, and keeps both passes in sync', async () => {
    const { user, fakes, original, clarinet } = await open()
    expect(original.timing.playOrder).toEqual([{ from: 1, to: 16 }, { from: 9, to: 16 }, { from: 17, to: 64 }])
    expect(original.timing.locators).toHaveLength(72)

    await splitClarinetBar12(user, clarinet)
    await insertBarAfter12(user)

    await waitFor(() => expect(timingOf(fakes).barCount).toBe(65))
    const timing = timingOf(fakes)
    expect(timing.playOrder).toEqual([{ from: 1, to: 17 }, { from: 9, to: 17 }, { from: 18, to: 65 }])
    await waitFor(() => expect(within(structurePanel()).getByText(strings.structure.bars.count(65))).toBeInTheDocument())

    // Bar n >= 13 carries what bar n-1 had, in both passes; the new bar 13 has no locator in either pass.
    const expected = original.timing.locators.map((locator) => ({ ...locator, bar: locator.bar >= 13 ? locator.bar + 1 : locator.bar }))
    expect(timing.locators).toHaveLength(72)
    const now = byKey(timing.locators)
    for (const locator of expected) expect(now.get(keyOf(locator))).toEqual(locator)
    for (const bar of [9, 10, 11, 12, 14, 15, 16, 17]) {
      expect(now.has(`${bar}:0`) && now.has(`${bar}:1`)).toBe(true)
    }
    expect(now.has('13:0')).toBe(false)
    expect(now.has('13:1')).toBe(false)
    expect(unmatchedSlots(timing).map((slot) => slot.bar)).toEqual([13, 13])

    // The screen says so, and Clarinet's 65 boxes match the piece's 65 bars.
    expect(status()).toHaveTextContent(text.status.unmatched(2))
    expect(boxes()).toHaveLength(65)
    expect(pagesOf(fakes).find((layer) => layer.partId === clarinet.partId)!.bars).toHaveLength(65)
  })

  it('then Realign gives all 74 slots one locator in time order and keeps the four confirmed ones at their times', async () => {
    const { user, fakes, original, clarinet } = await open()
    const confirmedBefore = original.timing.locators.filter((locator) => locator.confirmed)
    expect(confirmedBefore).toHaveLength(4)

    await splitClarinetBar12(user, clarinet)
    await insertBarAfter12(user)
    await waitFor(() => expect(timingOf(fakes).barCount).toBe(65))
    await waitFor(() => expect(status()).toHaveTextContent(text.status.unmatched(2)))

    await realign()

    await waitFor(() => expect(timingOf(fakes).locators).toHaveLength(74))
    const timing = timingOf(fakes)
    const slots = expandPlayOrder(timing.playOrder, timing.barCount)
    expect(slots).toHaveLength(74)
    const now = byKey(timing.locators)
    expect(now.size).toBe(74)
    const times = slots.map((slot) => now.get(`${slot.bar}:${slot.passIndex}`)!.timeSec)
    expect(times.every((time) => time !== undefined)).toBe(true)
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1])
    expect(unmatchedSlots(timing)).toHaveLength(0)

    for (const locator of confirmedBefore) {
      const shifted = { ...locator, bar: locator.bar >= 13 ? locator.bar + 1 : locator.bar }
      expect(now.get(keyOf(shifted))).toEqual(shifted)
    }
    expect(timing.locators.filter((locator) => locator.confirmed)).toHaveLength(4)

    expect(status()).not.toHaveTextContent(/no time in the recording/)
    expect(document.querySelectorAll('[data-state="unmatched"]')).toHaveLength(0)
  })
})

describe('Phase 5 checkpoint 2: a third pass of bars 9-16', () => {
  it('changes the play order to 1-16, 9-16, 9-16, 17-end: 8 unmatched slots first, 80 locators after Realign', async () => {
    // The recording has room for the third pass between its neighbours, so the labels stay and only the times are missing.
    const { user, fakes, original } = await open({ roomForRepeat: true })
    expect(original.timing.locators).toHaveLength(72)

    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')

    await waitFor(() => expect(timingOf(fakes).playOrder).toHaveLength(4))
    const before = timingOf(fakes)
    expect(before.playOrder).toEqual([{ from: 1, to: 16 }, { from: 9, to: 16 }, { from: 9, to: 16 }, { from: 17, to: 64 }])
    expect(before.locators).toHaveLength(72)
    expect(unmatchedSlots(before)).toHaveLength(8)
    expect(status()).toHaveTextContent(text.status.unmatched(8))

    await realign()

    await waitFor(() => expect(timingOf(fakes).locators).toHaveLength(80))
    const after = timingOf(fakes)
    expect(expandPlayOrder(after.playOrder, after.barCount)).toHaveLength(80)
    expect(unmatchedSlots(after)).toHaveLength(0)
    expect(after.locators.filter((locator) => locator.confirmed)).toHaveLength(4)
    expect(status()).not.toHaveTextContent(/no time in the recording/)
  })
})

describe('Phase 5 checkpoint 3: undo takes the document back to the start', () => {
  it('after a split, an insert and a Realign, three undos restore the saved layers and the screen', async () => {
    const { user, fakes, original, clarinet } = await open()
    await splitClarinetBar12(user, clarinet)
    await insertBarAfter12(user)
    await waitFor(() => expect(status()).toHaveTextContent(text.status.unmatched(2)))
    await realign()
    await waitFor(() => expect(timingOf(fakes).locators).toHaveLength(74))

    await undoAll(user, 3)

    await waitFor(() => expect(timingOf(fakes)).toEqual(original.timing))
    await waitFor(() => expect(pagesOf(fakes)).toEqual(original.pages))
    await waitFor(() => expect(boxes()).toHaveLength(64))
    expect(status()).not.toHaveTextContent(/no time in the recording|the piece has|structure changed/)
    expect(screen.queryByRole('button', { name: text.status.realign })).toBeNull()
    expect(screen.queryByText(text.notSaved)).toBeNull()
    // Escape closes the panel down to its title.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: strings.structure.title, expanded: false })).toBeInTheDocument()
    expect(undoButton()).toBeDisabled()
  })

  it('after a new play order and a Realign, two undos restore the saved layers and the screen', async () => {
    const { user, fakes, original } = await open()
    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')
    await waitFor(() => expect(status()).toHaveTextContent(text.status.unmatched(8)))
    await realign()
    await waitFor(() => expect(timingOf(fakes).locators).toHaveLength(80))

    await undoAll(user, 2)

    await waitFor(() => expect(timingOf(fakes)).toEqual(original.timing))
    await waitFor(() => expect(pagesOf(fakes)).toEqual(original.pages))
    expect(boxes()).toHaveLength(64)
    expect(status()).not.toHaveTextContent(/no time in the recording|the piece has|structure changed/)
    expect(screen.queryByRole('button', { name: text.status.realign })).toBeNull()
    // Escape closes the panel down to its title.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: strings.structure.title, expanded: false })).toBeInTheDocument()
    expect(undoButton()).toBeDisabled()
  })
})
