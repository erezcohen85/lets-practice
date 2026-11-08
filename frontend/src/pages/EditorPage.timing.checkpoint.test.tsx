import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expandPlayOrder } from '@/domain/playOrder'
import { type Locator, type PageLayer, type TimingLayer } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { barWithPass, strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// Phase 6 checkpoints (task 6.8): the real EditorPage on the demo piece with its repeat (bars 9-16 played twice), driven
// through the UI, judged on what the fake store holds and on what the screen says. Trumpet is the part whose bar line
// after bar 22 is missing (63 boxes); Clarinet is the complete one.

const CLARK = 'piece-clark-county'
const CLARK_TITLE = 'Clark County Celebration'
const text = strings.editor
const dock = strings.dock
const review = strings.review
const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
// One page wide at zoom 1 (the scroll container minus 16 px of padding each side): one image pixel is one screen pixel.
const COLUMN = PAGE_WIDTH + 2 * 16
/** The stage of the dock is this wide in jsdom (no layout): the pixel positions below are computed against it. */
const STAGE_WIDTH = 1000

async function open(partName: 'Clarinet in B♭ 1' | 'Trumpet in B♭ 2') {
  const fakes = createFakes({ seed: 'demo' })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const stored = fakes.store.maps.get(CLARK)!
  const original = structuredClone({ timing: stored.timing, pages: [...stored.pages.values()] })
  const detail = (await fakes.data.getPiece(CLARK))!
  const partId = detail.parts.find((part) => part.name === partName)!.id
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${partId}`, { fakes, playerSec: 271 })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  await screen.findByRole('timer', { name: dock.timeLabel })
  return { ...view, fakes, original, partId, part: original.pages.find((layer) => layer.partId === partId)! }
}

const page = (index: number) => {
  const el = document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, right: PAGE_WIDTH, bottom: PAGE_HEIGHT, x: 0, y: 0, toJSON() {} })
  return el
}
const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
const boxes = () => document.querySelectorAll('[data-slot="bar-box"]')
const boxState = (bar: number) => document.querySelector(`[data-slot="bar-box"][data-bar="${bar}"]`)!.getAttribute('data-state')
const queue = () => screen.getByRole('complementary', { name: review.queue.title })
const card = (bar: number) => within(queue()).getByRole('button', { name: new RegExp(`^Bar ${bar}\\b`) })
// The Edit sheet's button only: an open Review Queue card has an "Undo move" button of its own.
const undoButton = () => within(screen.getByRole('region', { name: text.sheet })).getByRole('button', { name: new RegExp(`^(${strings.history.undo}|${strings.history.nothingToUndo})`) })
const timingOf = (fakes: Fakes): TimingLayer => fakes.store.maps.get(CLARK)!.timing
const pagesOf = (fakes: Fakes): PageLayer[] => [...fakes.store.maps.get(CLARK)!.pages.values()]
const keyOf = (locator: Pick<Locator, 'bar' | 'passIndex'>) => `${locator.bar}:${locator.passIndex}`
const byKey = (locators: Locator[]) => new Map(locators.map((locator) => [keyOf(locator), locator]))
const locatorOf = (timing: TimingLayer, bar: number, passIndex = 0) => timing.locators.find((l) => l.bar === bar && l.passIndex === passIndex)!
const counts = (checked: number, total: number) => review.queue.checked(checked, total)

function click(el: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y })
  fireEvent.pointerUp(el, { clientX: x, clientY: y })
}

type User = Awaited<ReturnType<typeof open>>['user']

/** Add mode, a click in the middle of the part's bar `bar` (Trumpet's bar 22 is the wide box holding the missing line), then back to Move. */
async function splitBar(user: User, part: PageLayer, bar: number, boxesAfter: number) {
  await user.click(screen.getByRole('button', { name: text.modes.add }))
  const box = part.bars.find((candidate) => candidate.bar === bar)!
  click(page(box.pageIndex), box.x + box.w / 2, box.y + 50)
  await waitFor(() => expect(boxes()).toHaveLength(boxesAfter))
  await user.click(screen.getByRole('button', { name: text.modes.move }))
}

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

/** Drags the locator line at `fromSec` on the dock to `fromSec + deltaSec`: press, move, release. */
async function dragOnDock(fromSec: number, deltaSec: number) {
  await waitFor(() => expect(inWindow(fromSec)).toBe(true))
  const x = dockX(fromSec)
  fireEvent.pointerDown(stage(), { clientX: x, clientY: 60 })
  fireEvent.pointerMove(stage(), { clientX: dockX(fromSec + deltaSec / 2), clientY: 60 })
  fireEvent.pointerMove(stage(), { clientX: dockX(fromSec + deltaSec), clientY: 60 })
  fireEvent.pointerUp(stage(), { clientX: dockX(fromSec + deltaSec), clientY: 60 })
}

/** A click on the dock at a time that is not near a line, with Add locator on (a click moves the play line otherwise): with the Renumber switch on (the default) it adds a locator and moves the later ones. */
async function rippleAddOnDock(timeSec: number) {
  await waitFor(() => expect(inWindow(timeSec)).toBe(true))
  const addLocator = screen.getByRole('button', { name: strings.dock.addLocator })
  if (addLocator.getAttribute('aria-pressed') !== 'true') fireEvent.click(addLocator)
  const x = dockX(timeSec)
  fireEvent.pointerDown(stage(), { clientX: x, clientY: 60 })
  fireEvent.pointerUp(stage(), { clientX: x, clientY: 60 })
}

/** Selects bar `bar` on the score (Move mode), which brings its locator into the dock's window. */
function selectBarOnScore(part: PageLayer, bar: number) {
  const box = part.bars.find((candidate) => candidate.bar === bar)!
  click(page(box.pageIndex), box.x + box.w / 2, box.y + 50)
}

/** The one open card of the queue. */
function openCard() {
  const open = within(within(queue()).getByRole('list', { name: review.queue.list })).getAllByRole('button', { expanded: true })
  expect(open).toHaveLength(1)
  return open[0]
}

/** N, then the open card must be bar `bar`'s. */
async function nextProblem(user: User, bar: number) {
  await user.keyboard('n')
  expect(openCard()).toHaveAccessibleName(new RegExp(`^Bar ${bar}\\b`))
}

const action = (name: string) => within(queue()).getByRole('button', { name })

/** Presses Undo until it is disabled, and checks that it took exactly `steps` presses. */
async function undoAll(user: User, steps: number) {
  let presses = 0
  while (!(undoButton() as HTMLButtonElement).disabled && presses < steps + 2) {
    await user.click(undoButton())
    presses++
  }
  expect(presses).toBe(steps)
}

// Each checkpoint renders the whole editor and drives dozens of actions: well past the 5 s default when the suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Phase 6 checkpoint 1: Trumpet gets its missing bar line, then bar 41 is dragged', () => {
  it('renumbers Trumpet\'s later boxes, confirms bar 41 with its "was" line and leaves both passes of bars 9-16 alone', async () => {
    const { user, fakes, original, part } = await open('Trumpet in B♭ 2')
    expect(boxes()).toHaveLength(63)
    expect(within(queue()).getByText(counts(7, 13))).toBeInTheDocument()
    const before41 = locatorOf(original.timing, 41)
    // Bar 41 is one of the four confirmed anchors already (position 48); the drag keeps it confirmed.
    expect(before41.confirmed).toBe(true)

    await splitBar(user, part, 22, 64)

    // The part problem is gone from the queue; the twelve shared items are what is left.
    expect(within(queue()).getByText(counts(7, 12))).toBeInTheDocument()
    await waitFor(() => expect(pagesOf(fakes).find((layer) => layer.partId === part.partId)!.bars).toHaveLength(64))
    const bars = pagesOf(fakes).find((layer) => layer.partId === part.partId)!.bars
    expect(bars.map((box) => box.bar)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1))
    // Boxes after the split carry what the box one number lower had.
    for (const old of part.bars.filter((box) => box.bar >= 23)) expect(bars.find((box) => box.bar === old.bar + 1)).toEqual({ ...old, bar: old.bar + 1 })
    expect(boxes()).toHaveLength(64)

    await user.click(card(41))
    await dragOnDock(before41.timeSec, 0.42)

    await waitFor(() => expect(locatorOf(timingOf(fakes), 41).timeSec).not.toBe(before41.timeSec))
    const after41 = locatorOf(timingOf(fakes), 41)
    expect(after41.confirmed).toBe(true)
    expect(after41.timeSec).toBeCloseTo(before41.timeSec + 0.42, 6)
    // The "was" line sits at the old time, and the tag names the move.
    const was = document.querySelector('[data-slot="dock-was"]')!
    expect(was).toHaveTextContent(dock.was)
    expect(Number(was.querySelector('line')!.getAttribute('x1'))).toBeCloseTo(dockX(before41.timeSec), 4)
    expect(screen.getByText(dock.movedTag('41', '+0.42'))).toBeInTheDocument()
    expect(boxState(41)).toBe('moved')
    // The header keeps the flag chip alone; the open card says it was moved.
    expect(card(41)).not.toHaveTextContent(review.chips.moved)
    expect(within(queue()).getByText(review.explain.moved('+0.42'))).toBeInTheDocument()
    expect(action(review.queue.resolved)).toBeInTheDocument()
    expect(action(review.queue.undoMove)).toBeInTheDocument()

    // Both passes of the repeated bars keep their twins, and nothing else changed but bar 41.
    const now = byKey(timingOf(fakes).locators)
    for (let bar = 9; bar <= 16; bar++) {
      expect(now.get(`${bar}:0`)).toEqual(locatorOf(original.timing, bar, 0))
      expect(now.get(`${bar}:1`)).toEqual(locatorOf(original.timing, bar, 1))
    }
    expect(timingOf(fakes).locators).toHaveLength(72)
    for (const locator of original.timing.locators.filter((l) => l.bar !== 41)) expect(now.get(keyOf(locator))).toEqual(locator)
  })
})

describe('Phase 6 checkpoint 2: a ripple-added locator in the first pass of bars 9-16', () => {
  it('shifts every later locator one slot in both passes, updates the labels on the dock and saves the shift', async () => {
    const { user, fakes, original, part } = await open('Clarinet in B♭ 1')
    const slots = expandPlayOrder(original.timing.playOrder, original.timing.barCount)
    const at = (bar: number, passIndex: number) => slots.find((slot) => slot.bar === bar && slot.passIndex === passIndex)!.position
    const before11 = locatorOf(original.timing, 11)
    const before12 = locatorOf(original.timing, 12)
    const timeSec = (before11.timeSec + before12.timeSec) / 2

    selectBarOnScore(part, 11)
    await rippleAddOnDock(timeSec)

    // Saved: the new locator is bar 12 of the first pass (confirmed), and each old one from there on sits one slot later.
    await waitFor(() => expect(locatorOf(timingOf(fakes), 12).timeSec).toBe(timeSec))
    const timing = timingOf(fakes)
    const now = byKey(timing.locators)
    expect(locatorOf(timing, 12)).toEqual({ bar: 12, passIndex: 0, timeSec, confirmed: true })
    for (const old of original.timing.locators) {
      const position = at(old.bar, old.passIndex)
      if (position === 71) continue // the last locator has no slot left: it is dropped
      const target = position < at(12, 0) ? slots[position] : slots[position + 1]
      expect(now.get(keyOf(target))).toEqual({ ...old, bar: target.bar, passIndex: target.passIndex })
    }
    expect(timing.locators).toHaveLength(72)
    // The shift crosses the repeat: old 16 (first pass) is now the first bar of the second pass, old 11 (second pass) is "12 (2)".
    expect(now.get('9:1')!.timeSec).toBe(locatorOf(original.timing, 16, 0).timeSec)
    expect(now.get('12:1')!.timeSec).toBe(locatorOf(original.timing, 11, 1).timeSec)
    expect(now.get('17:0')!.timeSec).toBe(locatorOf(original.timing, 16, 1).timeSec)
    expect(now.get('64:0')!.timeSec).toBe(locatorOf(original.timing, 63, 0).timeSec)
    // The confirmed ones moved too (the last of the four fell off the end with its slot), and the new one is confirmed.
    expect(timing.locators.filter((l) => l.confirmed)).toHaveLength(4)

    // The labels on the dock: zoom the waveform out to two minutes and read each line's label.
    await user.keyboard('{Shift>}{-}{-}{-}{-}{/Shift}')
    expect(stage().dataset.viewSpan).toBe('120')
    const labels = new Map([...document.querySelectorAll('[data-slot="dock-locator"]')].map((el) => [`${el.getAttribute('data-bar')}:${el.getAttribute('data-pass')}`, el.textContent]))
    const start = Number(stage().dataset.viewStart)
    const inView = timing.locators.filter((l) => l.timeSec >= start - 0.5 && l.timeSec <= start + 120.5)
    expect(inView.length).toBeGreaterThan(28)
    for (const locator of inView) expect(labels.get(keyOf(locator))).toBe(barWithPass(String(locator.bar), locator.passIndex))
    expect(labels.get('12:0')).toBe('12')
    expect(labels.get('12:1')).toBe('12 (2)')
    expect(labels.get('9:1')).toBe('9 (2)')

    // The seven checked flags travelled with their locators: still 7 of 12, and the flag of old bar 14 is on bar 15.
    expect(within(queue()).getByText(counts(7, 12))).toBeInTheDocument()
    expect(card(15)).toBeInTheDocument()
    expect(within(queue()).queryByRole('button', { name: /^Bar 14\b/ })).toBeNull()
  })
})

describe('Phase 6 checkpoint 3: the queue walked to the end', () => {
  it('N, Sounds right, Resolved and Undo move take the open items to 12 of 12, and the hub shows the part fully checked', async () => {
    const { user, fakes, original, part, router } = await open('Trumpet in B♭ 2')
    await splitBar(user, part, 22, 64)
    expect(within(queue()).getByText(counts(7, 12))).toBeInTheDocument()
    const before = (bar: number) => locatorOf(original.timing, bar)

    // Bar 41: dragged, so it takes Resolved. Bar 43: dragged, then Undo move puts it back where it was.
    await nextProblem(user, 41)
    await dragOnDock(before(41).timeSec, 0.42)
    await waitFor(() => expect(locatorOf(timingOf(fakes), 41).timeSec).not.toBe(before(41).timeSec))
    expect(within(queue()).queryByRole('button', { name: review.queue.soundsRight })).toBeNull()

    await nextProblem(user, 43)
    await dragOnDock(before(43).timeSec, 0.3)
    await waitFor(() => expect(locatorOf(timingOf(fakes), 43).timeSec).toBeCloseTo(before(43).timeSec + 0.3, 6))
    expect(within(queue()).getByText(review.queue.movedByYou(2))).toBeInTheDocument()
    await user.click(action(review.queue.undoMove))
    await waitFor(() => expect(locatorOf(timingOf(fakes), 43)).toEqual(before(43)))
    expect(within(queue()).getByText(review.queue.movedByYou(1))).toBeInTheDocument()
    expect(within(queue()).getByText(counts(7, 12))).toBeInTheDocument()

    // The rest of the open items, in order: Sounds right.
    let checked = 7
    for (const bar of [45, 52, 60]) {
      await nextProblem(user, bar)
      await user.click(action(review.queue.soundsRight))
      checked++
      expect(within(queue()).getByText(counts(checked, 12))).toBeInTheDocument()
      await waitFor(() => expect(locatorOf(timingOf(fakes), bar)).toMatchObject({ confirmed: true, checked: true }))
    }

    // N comes round to the moved bar 41: Resolved; then to bar 43, which was put back and now sounds right.
    await nextProblem(user, 41)
    await user.click(action(review.queue.resolved))
    expect(within(queue()).getByText(counts(++checked, 12))).toBeInTheDocument()
    await nextProblem(user, 43)
    await user.click(action(review.queue.soundsRight))
    expect(within(queue()).getByText(counts(checked + 1, 12))).toBeInTheDocument()

    expect(within(queue()).getByText(counts(12, 12))).toBeInTheDocument()
    expect(within(queue()).queryByText(review.queue.movedByYou(1))).toBeNull()
    await waitFor(() => expect(timingOf(fakes).locators.filter((l) => (l.flags?.length ?? 0) > 0).every((l) => l.checked === true)).toBe(true))
    expect(locatorOf(timingOf(fakes), 41)).toMatchObject({ checked: true, confirmed: true })
    expect(locatorOf(timingOf(fakes), 41).timeSec).toBeCloseTo(before(41).timeSec + 0.42, 6)

    // The hub, reached in the app, reads the saved map: nothing left to check, on every part.
    await user.click(screen.getByRole('link', { name: text.pieceHub }))
    await screen.findByRole('heading', { level: 1, name: CLARK_TITLE })
    expect(router.state.location.pathname).toBe(`/pieces/${CLARK}`)
    expect(screen.queryByText(/^Needs review/)).toBeNull()
    const rows = within(screen.getByRole('list', { name: strings.hub.parts })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row).toHaveTextContent(strings.hub.partStatus.allChecked)
  })
})

describe('Phase 6 checkpoint 4: undo takes the document back to the start', () => {
  it('after a bar line, a ripple add, two drags, an undo move and the walk, ten undos restore both layers and the queue', async () => {
    const { user, fakes, original, part } = await open('Trumpet in B♭ 2')
    // The ripple add comes first, so the flagged bars 41, 43, 45, 52 and 60 are played one slot later: bars 42, 44, 46, 53 and 61.
    const before = (bar: number) => locatorOf(original.timing, bar)

    await splitBar(user, part, 22, 64) // 1
    selectBarOnScore(part, 11)
    await rippleAddOnDock((before(11).timeSec + before(12).timeSec) / 2) // 2
    await waitFor(() => expect(locatorOf(timingOf(fakes), 12).confirmed).toBe(true))
    expect(timingOf(fakes).locators).toHaveLength(72)
    expect(within(queue()).getByText(counts(7, 12))).toBeInTheDocument()

    await nextProblem(user, 42)
    await dragOnDock(before(41).timeSec, 0.42) // 3
    await nextProblem(user, 44)
    await dragOnDock(before(43).timeSec, 0.3) // 4
    await waitFor(() => expect(locatorOf(timingOf(fakes), 44).timeSec).toBeCloseTo(before(43).timeSec + 0.3, 6))
    await user.click(action(review.queue.undoMove)) // 5
    for (const bar of [46, 53, 61]) {
      await nextProblem(user, bar)
      await user.click(action(review.queue.soundsRight)) // 6, 7, 8
    }
    await nextProblem(user, 42)
    await user.click(action(review.queue.resolved)) // 9
    await nextProblem(user, 44)
    await user.click(action(review.queue.soundsRight)) // 10
    expect(within(queue()).getByText(counts(12, 12))).toBeInTheDocument()
    await waitFor(() => expect(locatorOf(timingOf(fakes), 44)).toMatchObject({ checked: true, timeSec: before(43).timeSec }))

    await undoAll(user, 10)

    await waitFor(() => expect(timingOf(fakes)).toEqual(original.timing))
    await waitFor(() => expect(pagesOf(fakes)).toEqual(original.pages))
    // Trumpet is back to its 63 boxes, so its own bar-count problem is back in the queue: 7 of 13, as at the start.
    await waitFor(() => expect(boxes()).toHaveLength(63))
    expect(within(queue()).getByText(counts(7, 13))).toBeInTheDocument()
    expect(within(queue()).getByText(review.chips.part)).toBeInTheDocument()
    expect(document.querySelector('[data-slot="dock-was"]')).toBeNull()
    expect(document.querySelector('[data-slot="dock-moved-tag"]')).toBeNull()
    expect(undoButton()).toBeDisabled()
    expect(screen.queryByText(text.notSaved)).toBeNull()
  })
})

describe('a drag after N', () => {
  it('moves the next line too: N opens bar 41, 41 is dragged, then 40 and 42 are dragged without pressing N again', async () => {
    const { user, fakes, original } = await open('Clarinet in B♭ 1')
    const before = (bar: number) => locatorOf(original.timing, bar)

    await nextProblem(user, 41)
    await dragOnDock(before(41).timeSec, 0.42)
    await waitFor(() => expect(locatorOf(timingOf(fakes), 41).timeSec).toBeCloseTo(before(41).timeSec + 0.42, 6))
    await dragOnDock(before(40).timeSec, 0.2)
    await waitFor(() => expect(locatorOf(timingOf(fakes), 40).timeSec).toBeCloseTo(before(40).timeSec + 0.2, 6))
    await dragOnDock(before(42).timeSec, -0.2)
    await waitFor(() => expect(locatorOf(timingOf(fakes), 42).timeSec).toBeCloseTo(before(42).timeSec - 0.2, 6))

    // Each line was grabbed and kept: three moved lines, three "was" lines, 41 still where it was dragged to.
    expect(document.querySelectorAll('[data-slot="dock-was"]')).toHaveLength(3)
    expect(locatorOf(timingOf(fakes), 41).timeSec).toBeCloseTo(before(41).timeSec + 0.42, 6)
    expect(locatorOf(timingOf(fakes), 40)).toMatchObject({ confirmed: true })
  })
})
