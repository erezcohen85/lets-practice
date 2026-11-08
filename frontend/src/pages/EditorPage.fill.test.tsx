import { turnOnPieceEditing } from '@/test/pieceChange'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { unmatchedSlots } from '@/domain/renumber'
import { type TimingLayer } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { makeRoomForRepeat } from '@/test/roomForRepeat'

// UX part 9c: an edit that leaves play slots without a time is followed at once by a fill (the processor aligns only
// those slots), recorded as its own undo step; a fill that cannot be fitted leaves the bars empty with the banner.

const CLARK = 'piece-clark-county'
const text = strings.editor
const COLUMN = 1240 + 2 * 16

async function open(fakes: Fakes = createFakes({ seed: 'demo' })) {
  // The shared store holds what the editor opens: a test that wants bars without a time takes their locators out first.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const original: TimingLayer = structuredClone(fakes.store.maps.get(CLARK)!.timing)
  const detail = (await fakes.data.getPiece(CLARK))!
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${detail.parts[0].id}`, { fakes })
  // A long wait: under a full run the page images come late.
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 10_000 })
  return { ...view, fakes, original }
}

const status = () => document.querySelector<HTMLElement>('[data-slot="editor-status"]')!
const undoButton = () => screen.getByRole('button', { name: new RegExp(`^(${strings.history.undo}|${strings.history.nothingToUndo})`) })
const timingOf = (fakes: Fakes): TimingLayer => fakes.store.maps.get(CLARK)!.timing

/** Structure > Play order > Edit as text, with the play order line replaced. */
async function setPlayOrderText(user: Awaited<ReturnType<typeof open>>['user'], line: string) {
  await turnOnPieceEditing(user)
  if (screen.queryByRole('switch', { name: strings.structure.editAsText }) === null) await user.click(screen.getByRole('button', { name: strings.structure.title }))
  const toggle = screen.getByRole('switch', { name: strings.structure.editAsText })
  if (toggle.getAttribute('aria-checked') !== 'true') await user.click(toggle)
  const textbox = screen.getByRole('textbox', { name: strings.structure.text.label }) as HTMLTextAreaElement
  fireEvent.change(textbox, { target: { value: textbox.value.replace(/^play order:.*$/m, line) } })
  await user.click(screen.getByRole('button', { name: strings.structure.apply }))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('filling the bars an edit left without a time', () => {
  it('gives a third pass of bars 9-16 its times at once, keeps every locator that was there, and says so', async () => {
    // The recording has room for the new pass between its neighbours: the labels are right, only the times are missing.
    const room = createFakes({ seed: 'demo' })
    makeRoomForRepeat(room, CLARK)
    const { user, fakes, original } = await open(room)

    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')

    await waitFor(() => expect(timingOf(fakes).locators).toHaveLength(80))
    const after = timingOf(fakes)
    expect(unmatchedSlots(after)).toHaveLength(0)
    for (const locator of original.locators) expect(after.locators).toContainEqual(locator)
    expect(after.locators.filter((locator) => locator.passIndex === 2 && locator.bar >= 9 && locator.bar <= 16)).toHaveLength(8)
    expect(status()).toHaveTextContent(text.status.filled(8))
    expect(status()).not.toHaveTextContent(/no time in the recording/)
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: fill the empty bars`)
  })

  it('relabels the locators instead when the recording has no room for the new pass, says so, and Undo gives every label and confirmation back', async () => {
    const { user, fakes, original } = await open()

    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')

    await waitFor(() => expect(status()).toHaveTextContent(text.status.relabeled(48)))
    // every time is still there: the new labels sit on the same times
    const times = (timing: TimingLayer) => timing.locators.map((l) => l.timeSec)
    expect(times(timingOf(fakes)).slice(0, 72)).toEqual(times(original))
    // of the four confirmed locators only the first kept its label, so only it is still confirmed
    expect(timingOf(fakes).locators.filter((l) => l.confirmed)).toHaveLength(1)

    // the relabel and the fill are two steps: Undo the fill, then the relabel
    await waitFor(() => expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: fill the empty bars`))
    await user.click(undoButton())
    await user.click(undoButton())
    await waitFor(() => expect(timingOf(fakes).locators).toEqual(original.locators))
    expect(timingOf(fakes).playOrder).toEqual(original.playOrder)
  })

  it('is one undo step: Undo takes the filled bars away again and does not fill them a second time', async () => {
    const { user, fakes } = await open()
    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')
    await waitFor(() => expect(timingOf(fakes).locators).toHaveLength(80))

    await user.click(undoButton())

    await waitFor(() => expect(timingOf(fakes).locators).toHaveLength(72))
    expect(timingOf(fakes).playOrder).toHaveLength(4)
    expect(status()).toHaveTextContent(text.status.unmatched(8))
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: edit play order`)
  })

  it('leaves the bars empty, with the banner, when the processor cannot fit them', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const fill = vi.spyOn(fakes.processor, 'fillEmptyBars').mockResolvedValue(null)
    const { user } = await open(fakes)

    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')

    await waitFor(() => expect(fill).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(status()).toHaveTextContent(text.status.unmatched(8)))
    expect(timingOf(fakes).locators).toHaveLength(72)
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: edit play order`)
  })

  it('says why when the processor cannot fit them, until the next edit', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.processor, 'fillEmptyBars').mockResolvedValue(null)
    const { user } = await open(fakes)

    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')

    await waitFor(() => expect(status()).toHaveTextContent(text.status.noRoom))
    await user.click(undoButton())
    await waitFor(() => expect(status()).not.toHaveTextContent(text.status.noRoom))
  })

  it('says so too when the fill leaves some of the bars empty', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.processor, 'fillEmptyBars').mockImplementation(async (_piece, timing) => ({
      ...timing,
      locators: [...timing.locators, { bar: 9, passIndex: 2, timeSec: timing.locators[timing.locators.length - 1].timeSec + 1000, confirmed: false }],
    }))
    const { user } = await open(fakes)
    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')
    // That one time does not fit between its neighbours, so the fill gives nothing: the sentence is the same.
    await waitFor(() => expect(status()).toHaveTextContent(text.status.noRoom))
  })

  it('asks the processor with the timing that has the empty bars, and drops an answer that comes after another edit', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const real = fakes.processor.fillEmptyBars.bind(fakes.processor)
    const answers: Array<() => void> = []
    const sent: TimingLayer[] = []
    vi.spyOn(fakes.processor, 'fillEmptyBars').mockImplementation(
      (pieceId, timing) =>
        new Promise((resolve) => {
          sent.push(timing)
          answers.push(() => resolve(real(pieceId, timing)))
        }),
    )
    const { user } = await open(fakes)

    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].playOrder).toHaveLength(4)
    expect(unmatchedSlots(sent[0])).toHaveLength(8)
    await setPlayOrderText(user, 'play order: 1-16, 9-16, 17-end')
    answers[0]() // the answer for the first edit: its timing is gone
    await waitFor(() => expect(screen.queryByText(text.status.filling)).toBeNull())

    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: edit play order`)
    expect(status()).not.toHaveTextContent(/were filled in/)
  })
})

/** The demo piece stored with the locators of bars 20 to 23 (first pass) taken out, as an older edit left it. */
function withGap(): Fakes {
  const fakes = createFakes({ seed: 'demo' })
  const map = fakes.store.maps.get(CLARK)!
  map.timing = { ...map.timing, locators: map.timing.locators.filter((l) => !(l.passIndex === 0 && l.bar >= 20 && l.bar <= 23)) }
  return fakes
}

describe('filling when the Editor opens', () => {
  it('fills the bars a saved map has no time for, once, as one undo step', async () => {
    const fakes = withGap()
    const fill = vi.spyOn(fakes.processor, 'fillEmptyBars')
    const { original } = await open(fakes)
    expect(unmatchedSlots(original)).toHaveLength(4)

    await waitFor(() => expect(timingOf(fakes).locators).toHaveLength(72))

    expect(unmatchedSlots(timingOf(fakes))).toHaveLength(0)
    expect(fill).toHaveBeenCalledTimes(1)
    expect(status()).toHaveTextContent(text.status.filled(4))
    expect(status()).not.toHaveTextContent(/no time in the recording/)
    expect(undoButton()).toHaveAccessibleName(`${strings.history.undo}: fill the empty bars`)
  })

  it('leaves the bars empty, with the banner, when the processor cannot fit them', async () => {
    const fakes = withGap()
    const fill = vi.spyOn(fakes.processor, 'fillEmptyBars').mockResolvedValue(null)
    await open(fakes)

    await waitFor(() => expect(fill).toHaveBeenCalledTimes(1))

    await waitFor(() => expect(status()).toHaveTextContent(text.status.unmatched(4)))
    expect(timingOf(fakes).locators).toHaveLength(68)
    expect(screen.getByRole('button', { name: strings.history.nothingToUndo })).toBeDisabled()
  })

  it('does not call the processor for a map with a time for every bar', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const fill = vi.spyOn(fakes.processor, 'fillEmptyBars')
    await open(fakes)

    expect(fill).not.toHaveBeenCalled()
  })
})

describe('the "structure changed" line after a fill', () => {
  it('goes away when the fill leaves no empty bar', async () => {
    const { user, fakes } = await open()

    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')

    await waitFor(() => expect(timingOf(fakes).locators).toHaveLength(80))
    await waitFor(() => expect(status()).not.toHaveTextContent(text.status.structureChanged))
    expect(screen.queryByRole('button', { name: text.status.realign })).toBeNull()
  })

  it('stays when the bars could not be filled', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.processor, 'fillEmptyBars').mockResolvedValue(null)
    const { user } = await open(fakes)

    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')

    await waitFor(() => expect(status()).toHaveTextContent(text.status.unmatched(8)))
    expect(screen.getByRole('button', { name: text.status.realign })).toBeInTheDocument()
  })

  it('stays when the fill left some bars empty', async () => {
    const fakes = createFakes({ seed: 'demo' })
    makeRoomForRepeat(fakes, CLARK)
    const real = fakes.processor.fillEmptyBars.bind(fakes.processor)
    // The answer only has the first four of the eight new bars.
    vi.spyOn(fakes.processor, 'fillEmptyBars').mockImplementation(async (pieceId, timing) => {
      const answer = await real(pieceId, timing)
      const dropped = new Set(['13:2', '14:2', '15:2', '16:2'])
      return answer === null ? null : { ...answer, locators: answer.locators.filter((l) => !dropped.has(`${l.bar}:${l.passIndex}`)) }
    })
    const { user, fakes: shared } = await open(fakes)

    await setPlayOrderText(user, 'play order: 1-16, 9-16, 9-16, 17-end')

    await waitFor(() => expect(timingOf(shared).locators).toHaveLength(76))
    expect(status()).toHaveTextContent(text.status.unmatched(4))
    expect(screen.getByRole('button', { name: text.status.realign })).toBeInTheDocument()
  })
})

describe('the "structure changed" line after Marks', () => {
  /** Structure > Marks, one row added with the kind and bars given, applied. */
  async function addMark(user: Awaited<ReturnType<typeof open>>['user'], markKind: string, from: string, to: string) {
    // A rest is the part's own (This part > Rests); fermata and rit. are the piece's, behind Edit piece structure.
    if (markKind !== 'rest') await turnOnPieceEditing(user)
    await user.click(screen.getByRole('button', { name: strings.structure.title }))
    await user.click(
      markKind === 'rest'
        ? screen.getByRole('tab', { name: `${strings.structure.sections.rests} (${strings.structure.groups.part('Clarinet in B♭ 1')})` })
        : screen.getByRole('tab', { name: strings.structure.sections.marks }),
    )
    await user.click(screen.getByRole('button', { name: strings.structure.marks.add }))
    const row = document.querySelectorAll('[role="tabpanel"] li').length
    await user.selectOptions(screen.getByLabelText(strings.structure.marks.rowKind(row)), markKind)
    await user.type(screen.getByLabelText(strings.structure.marks.rowFrom(row)), from)
    await user.type(screen.getByLabelText(strings.structure.marks.rowTo(row)), to)
    await user.click(screen.getByRole('button', { name: strings.structure.apply }))
  }

  it('does not appear for a rest, which belongs to a part and does not move the times', async () => {
    const { user, fakes } = await open()

    await addMark(user, 'rest', '20', '22')

    // The open part (the first) rests there once the edit is saved; nothing else about the piece changed.
    const rests = () => [...fakes.store.maps.get(CLARK)!.pages.values()][0].rests
    await waitFor(() => expect(rests()).toEqual([5, 6, 7, 8, 20, 21, 22]))
    expect(status()).not.toHaveTextContent(text.status.structureChanged)
  })

  it('appears for a rit., which the alignment uses', async () => {
    const { user } = await open()

    await addMark(user, 'rit', '40', '41')

    await waitFor(() => expect(status()).toHaveTextContent(text.status.structureChanged))
  })
})
