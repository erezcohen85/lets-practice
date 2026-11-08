import { screen, waitFor, within } from '@testing-library/react'
import { type Locator, type ReviewFlag, type TimingLayer } from '@/domain/types'
import { DEFAULT_SETTINGS } from '@/lib/dataClient'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// The Wrong beat card and the automatic re-grid in the real Editor on the demo piece, with the fakes: the processor heard the
// recording at 2 beats a bar where the score has 4, so the card puts the bar lines of the whole piece on every 2nd beat as one
// undo step, says what it did and resolves itself; with "Fix a wrong beat by itself" on, the Editor does the same once when it opens.

const CLARK = 'piece-clark-county'
const g = strings.dock.grid
const q = strings.review.queue
const PAGE_WIDTH = 1240
const COLUMN = PAGE_WIDTH + 2 * 16
/** The demo piece plays 72 bars: bars 1 to 16, 9 to 16 again, 17 to 64. */
const SLOTS = 72

const pulse = (rest: Partial<ReviewFlag> = {}): ReviewFlag => ({ kind: 'pulse', severity: 1, expected: 4, found: 2.03, factor: 0.5, explainedBy: null, uncertainLine: null, ...rest })

/**
 * The recording has a beat every half second from 1 s. Bars 1 to 12 are lines on every 4th beat (1, 3, ... 23 s), the others have none
 * until the Editor fills them in when it opens. `first` replaces the first line's fields: the flag, checked.
 */
function lines(first: Partial<Locator> = { flags: [pulse()] }, later: Record<number, Partial<Locator>> = {}) {
  return (fakes: Fakes) => {
    fakes.store.beats.set(
      CLARK,
      Array.from({ length: 200 }, (_, i) => ({ t: 1 + 0.5 * i, downbeat: i % 4 === 0 ? 0.9 : 0.1 })),
    )
    const map = fakes.store.maps.get(CLARK)!
    const found: Locator[] = Array.from({ length: 12 }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 1 + 2 * i, confirmed: false, ...(i === 0 ? first : {}), ...later[i + 1] }))
    map.timing = { ...map.timing, locators: found }
  }
}

interface OpenOptions { autoRegrid?: boolean; fakes?: Fakes }

async function open(prepare: ((fakes: Fakes) => void) | null, { autoRegrid, fakes = createFakes({ seed: 'demo' }) }: OpenOptions = {}) {
  prepare?.(fakes)
  if (autoRegrid !== undefined) await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, autoRegrid })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const view = renderWithApp(`/pieces/${CLARK}/edit`, { fakes, playerSec: 271 })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  await screen.findByRole('timer', { name: strings.dock.timeLabel })
  // The Editor fills the bars that have no line when it opens (one step of its own): wait for it.
  await waitFor(() => expect(timesOf(fakes)).toHaveLength(SLOTS))
  return { ...view, fakes }
}

const timingOf = (fakes: Fakes): TimingLayer => fakes.store.maps.get(CLARK)!.timing
const timesOf = (fakes: Fakes): number[] => timingOf(fakes).locators.map((l) => l.timeSec)
const firstLine = (fakes: Fakes): Locator => timingOf(fakes).locators[0]
const undoButton = () => within(screen.getByRole('region', { name: strings.editor.sheet })).getByRole('button', { name: new RegExp(`^(${strings.history.undo}|${strings.history.nothingToUndo})`) })
const queue = () => screen.getByRole('complementary', { name: strings.review.queue.title })
const card = () => screen.getByRole('button', { name: /^Bar 1\b/ })
const cardItem = () => card().closest('li')!

/** Every 2nd beat from 1 s, the 2/4 bars from bar 49 taking half of that: what the whole piece looks like at 2 beats a bar. */
const doubled = (i: number) => (i <= 56 ? i + 1 : 57 + (i - 56) / 2)
const AT_TWO_BEATS = Array.from({ length: SLOTS }, (_, i) => doubled(i))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the Wrong beat card in the Editor', () => {
  it('lists the first bar as Wrong beat, with the sentence and the button when it is opened', async () => {
    const { user } = await open(lines())

    expect(card()).toHaveTextContent('Bar 1 Wrong beat')
    expect(within(queue()).getByText(strings.review.queue.checked(0, 1))).toBeInTheDocument()
    await user.click(card())

    expect(within(cardItem()).getByText(strings.review.explain.pulse(2, 4))).toBeInTheDocument()
    expect(strings.review.explain.pulse(2, 4)).toBe(
      "The recording's beat looks like 2 per bar, not 4. Check the first 3 bars by ear and press Continue, or put the bar lines on every 2 beats now. If the recording takes the repeats, set them in Edit piece structure first.",
    )
    expect(within(cardItem()).getByRole('button', { name: q.putOnBeats })).toBeInTheDocument()
  })

  it('puts the lines of the whole piece on the beats without a question, says what it did, resolves the card, and Undo takes it all back in one step', async () => {
    const { fakes, user } = await open(lines())
    const before = timesOf(fakes)
    await user.click(card())

    await user.click(within(cardItem()).getByRole('button', { name: q.putOnBeats }))

    // no "Change the whole piece?" question: the card is the question
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(timesOf(fakes)).toEqual(AT_TWO_BEATS))
    expect(await screen.findByText(g.done(40, 40, 0))).toBeInTheDocument()
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: put bar lines on the beats`)
    // resolved: the first line is checked (not a fixed anchor), the card is done and has no button
    await waitFor(() => expect(firstLine(fakes)).toMatchObject({ checked: true, confirmed: false }))
    expect(card()).toHaveTextContent(q.checkedMark)
    expect(within(queue()).getByText(strings.review.queue.checked(1, 1))).toBeInTheDocument()
    expect(within(cardItem()).queryByRole('button', { name: q.putOnBeats })).not.toBeInTheDocument()

    await user.click(undoButton())

    await waitFor(() => expect(timesOf(fakes)).toEqual(before))
    expect(firstLine(fakes).checked).not.toBe(true)
    expect(card()).not.toHaveTextContent(q.checkedMark)
    // one step: nothing of the card is left to undo
    expect(undoButton()).not.toHaveAccessibleName(/put bar lines on the beats/)
  })

  it('works when the flag is not on the first bar any more (a pickup was added): the button puts the lines on the beats and the card closes', async () => {
    // the flag sits on the second line, at 3 s; the first line has none
    const { fakes, user } = await open(lines({}, { 2: { flags: [pulse()] } }))
    const secondCard = () => screen.getByRole('button', { name: /^Bar 2\b/ })
    expect(secondCard()).toHaveTextContent('Bar 2 Wrong beat')
    await user.click(secondCard())

    await user.click(within(secondCard().closest('li')!).getByRole('button', { name: q.putOnBeats }))

    await waitFor(() => expect(timesOf(fakes)).toEqual(AT_TWO_BEATS))
    // what it did, and not the "none would change" sentence
    expect(await screen.findByText(g.done(40, 40, 0))).toBeInTheDocument()
    expect(screen.queryByText(g.refusedNothing)).not.toBeInTheDocument()
    // the line at 3 s kept its flag and is bar 3 now: it is the one that is checked, and the first line is not
    const flagged = timingOf(fakes).locators.find((l) => l.flags?.some((f) => f.kind === 'pulse'))
    expect(flagged).toMatchObject({ bar: 3, timeSec: 3, checked: true })
    expect(firstLine(fakes).checked).not.toBe(true)
    expect(within(queue()).getByText(q.checked(1, 1))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Bar 3\b/ })).toHaveTextContent(q.checkedMark)
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: put bar lines on the beats`)
  })

  it('on, the flag not on the first bar: the Editor puts the lines on the beats once when it opens', async () => {
    const { fakes } = await open(lines({}, { 2: { flags: [pulse()] } }), { autoRegrid: true })

    await waitFor(() => expect(timesOf(fakes)).toEqual(AT_TWO_BEATS))
    expect(await screen.findByText(g.done(40, 40, 0))).toBeInTheDocument()
    await waitFor(() => expect(timingOf(fakes).locators.find((l) => l.flags?.some((f) => f.kind === 'pulse'))?.checked).toBe(true))
  })

  it('says so on the card, and stays, when the lines are on those beats already', async () => {
    // The flag asks for the 4 beats a bar (factor x the 4/4 bar's 4 beats) that the lines have: nothing would change. Contrived: a real flag never asks for the score's own pulse.
    const { fakes, user } = await open(lines({ flags: [pulse({ found: 4.02, expected: 4, factor: 1.005 })] }))
    const before = timesOf(fakes)
    await user.click(card())

    await user.click(within(cardItem()).getByRole('button', { name: q.putOnBeats }))

    expect(await within(cardItem()).findByText(g.refusedNothing)).toBeInTheDocument()
    expect(card()).toHaveAttribute('aria-expanded', 'true')
    expect(within(cardItem()).getByRole('button', { name: q.putOnBeats })).toBeInTheDocument()
    expect(timesOf(fakes)).toEqual(before)
    expect(firstLine(fakes).checked).not.toBe(true)
    expect(undoButton()).not.toHaveAccessibleName(/put bar lines on the beats/)
  })

  it('says the recording has no detected beats when it has none, and changes nothing', async () => {
    const { fakes, user } = await open((f) => {
      lines()(f)
      f.store.beats.delete(CLARK)
    })
    const before = timesOf(fakes)
    await user.click(card())

    await user.click(within(cardItem()).getByRole('button', { name: q.putOnBeats }))

    expect(await within(cardItem()).findByText(g.noBeats)).toBeInTheDocument()
    expect(timesOf(fakes)).toEqual(before)
  })

  it('offers no button, and says nothing about missing beats, while the beats are still loading; the button comes when they have', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const getBeats = fakes.data.getBeats.bind(fakes.data)
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fakes.data.getBeats = async (pieceId) => {
      await gate
      return getBeats(pieceId)
    }
    const { user } = await open(lines(), { fakes })
    await user.click(card())

    expect(within(cardItem()).queryByRole('button', { name: q.putOnBeats })).not.toBeInTheDocument()
    expect(within(cardItem()).getByRole('button', { name: q.soundsRight })).toBeInTheDocument()
    expect(screen.queryByText(g.noBeats)).not.toBeInTheDocument()

    release()

    expect(await within(cardItem()).findByRole('button', { name: q.putOnBeats })).toBeInTheDocument()
  })

  it('keeps Sounds right as the way to say the beat is fine, and a map with an older flag kind is read as before', async () => {
    const { fakes, user } = await open(lines({ flags: [{ ...pulse(), kind: 'skipped-repeat', expected: 78, found: 56, factor: null }] }))
    await user.click(card())

    expect(card()).toHaveTextContent('Repeat skipped')
    expect(within(cardItem()).queryByRole('button', { name: q.putOnBeats })).not.toBeInTheDocument()
    expect(within(cardItem()).getByRole('button', { name: q.soundsRight })).toBeInTheDocument()
    expect(firstLine(fakes).flags?.[0].kind).toBe('skipped-repeat')
  })
})

describe('the automatic re-grid when the Editor opens', () => {
  it('on: puts the lines on the beats once, says what it did with Undo at hand, and resolves the flag', async () => {
    const { fakes, user } = await open(lines(), { autoRegrid: true })

    await waitFor(() => expect(timesOf(fakes)).toEqual(AT_TWO_BEATS))
    expect(await screen.findByText(g.done(40, 40, 0))).toBeInTheDocument()
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: put bar lines on the beats`)
    await waitFor(() => expect(firstLine(fakes)).toMatchObject({ checked: true, confirmed: false }))
    expect(card()).toHaveTextContent(q.checkedMark)

    // Undo puts it all back, and the Editor does not do it again for the same visit
    await user.click(undoButton())
    await waitFor(() => expect(timesOf(fakes)).not.toEqual(AT_TWO_BEATS))
    await waitFor(() => expect(firstLine(fakes).checked).not.toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(timesOf(fakes)).not.toEqual(AT_TWO_BEATS)
    expect(firstLine(fakes).checked).not.toBe(true)
    expect(undoButton()).not.toHaveAccessibleName(/put bar lines on the beats/)
  })

  it('on: waits for the Editor to fill the bars the map opened without, so the fill is a step of its own and is not thrown away', async () => {
    const fakes = createFakes({ seed: 'demo' })
    // the processor is slow: the beats are in long before the fill
    const fill = fakes.processor.fillEmptyBars.bind(fakes.processor)
    fakes.processor.fillEmptyBars = async (pieceId, timing) => {
      await new Promise((resolve) => setTimeout(resolve, 400))
      return fill(pieceId, timing)
    }
    const { user } = await open(lines(), { autoRegrid: true, fakes })

    await waitFor(() => expect(timesOf(fakes)).toEqual(AT_TWO_BEATS))
    // long enough for a fill that was started before the re-grid to have come back
    await new Promise((resolve) => setTimeout(resolve, 700))
    await user.click(undoButton())

    // Undo of the re-grid leaves the filled map. Had the re-grid gone first, the fill would have been dropped and Undo would leave the 12 lines.
    await waitFor(() => expect(timesOf(fakes)).toHaveLength(SLOTS))
    expect(timesOf(fakes)).not.toEqual(AT_TWO_BEATS)
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: fill the empty bars`)
  })

  it('on: Redo brings it back and does not apply it a second time', async () => {
    const { fakes, user } = await open(lines(), { autoRegrid: true })
    await waitFor(() => expect(timesOf(fakes)).toEqual(AT_TWO_BEATS))
    await user.click(undoButton())
    await waitFor(() => expect(timesOf(fakes)).not.toEqual(AT_TWO_BEATS))

    await user.click(within(screen.getByRole('region', { name: strings.editor.sheet })).getByRole('button', { name: new RegExp(`^${strings.history.redo}`) }))

    await waitFor(() => expect(timesOf(fakes)).toEqual(AT_TWO_BEATS))
    expect(timesOf(fakes)).toHaveLength(SLOTS)
  })

  it('off (the default): nothing happens by itself, the card waits', async () => {
    const { fakes } = await open(lines())
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(timesOf(fakes)).not.toEqual(AT_TWO_BEATS)
    expect(firstLine(fakes).checked).not.toBe(true)
    expect(card()).not.toHaveTextContent(q.checkedMark)
    expect(undoButton()).not.toHaveAccessibleName(/put bar lines on the beats/)
  })

  it('on, but the flag is resolved already: nothing happens', async () => {
    const { fakes } = await open(lines({ flags: [pulse()], checked: true }), { autoRegrid: true })
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(timesOf(fakes)).not.toEqual(AT_TWO_BEATS)
    expect(undoButton()).not.toHaveAccessibleName(/put bar lines on the beats/)
  })

  it('on, but the map has no pulse flag: it opens exactly as before', async () => {
    const { fakes } = await open(lines({}), { autoRegrid: true })
    const filled = timesOf(fakes)
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(timesOf(fakes)).toEqual(filled)
    expect(undoButton()).not.toHaveAccessibleName(/put bar lines on the beats/)
    expect(within(queue()).getByText(q.empty)).toBeInTheDocument()
  })

  it('on, but the lines are on those beats already: nothing changes and the card stays', async () => {
    const { fakes } = await open(lines({ flags: [pulse({ found: 4.02, expected: 4, factor: 1.005 })] }), { autoRegrid: true })
    const filled = timesOf(fakes)
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(timesOf(fakes)).toEqual(filled)
    expect(card()).toHaveTextContent('Wrong beat')
    expect(card()).not.toHaveTextContent(q.checkedMark)
  })
})
