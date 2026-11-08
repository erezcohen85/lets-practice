import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { type PageLayer, type PieceMap } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const PIECE_ID = 'piece-clark-county'
const text = strings.editor
const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754
// One page wide at zoom 1 (the scroll container minus 16 px of padding each side): one image pixel is one screen pixel.
const COLUMN = PAGE_WIDTH + 2 * 16

interface Setup { fakes: Fakes; map: PieceMap; partId: string; part: PageLayer }

/** The Edit sheet and the score as the Editor page wires them: the Clark County piece on the fakes, open on the part at `partIndex` (0 clarinet, 1 trumpet). */
async function setup(partIndex = 0): Promise<Setup & { user: ReturnType<typeof renderWithApp>['user'] }> {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const fakes = createFakes({ seed: 'demo' })
  const map = (await fakes.data.getPieceMap(PIECE_ID))!
  const part = map.pages[partIndex]
  const { user } = renderWithApp(`/pieces/${PIECE_ID}/edit?part=${part.partId}`, { fakes })
  const scratch = document.createElement('input')
  scratch.setAttribute('aria-label', 'scratch')
  document.body.append(scratch)
  await screen.findByRole('region', { name: text.sheet })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  return { fakes, map, partId: part.partId, part, user }
}

const page = (index = 0) => {
  const el = document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, right: PAGE_WIDTH, bottom: PAGE_HEIGHT, x: 0, y: 0, toJSON() {} })
  return el
}
const mode = (name: string) => screen.getByRole('button', { name })
/** The hint of the mode, in the status row above the Edit sheet. */
const sheetHint = () => document.querySelector<HTMLElement>('[data-slot="edit-hint"]')!

function click(el: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y })
  fireEvent.pointerUp(el, { clientX: x, clientY: y })
}

async function saved(fakes: Fakes): Promise<PieceMap> {
  return (await fakes.data.getPieceMap(PIECE_ID))!
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.querySelector('input[aria-label="scratch"]')?.remove()
})

describe('the sheet and the score together', () => {
  it('opens in Move with no hint', async () => {
    await setup()

    expect(mode(text.modes.move)).toHaveAttribute('aria-pressed', 'true')
    expect(sheetHint()).toBeEmptyDOMElement()
  })

  it('switches the mode with the buttons and with the keys V, B and X, and the hint follows', async () => {
    const { user } = await setup()

    await user.click(mode(text.modes.add))
    expect(mode(text.modes.add)).toHaveAttribute('aria-pressed', 'true')
    expect(sheetHint()).toHaveTextContent(text.hints.add)

    await user.keyboard('x')
    expect(mode(text.modes.delete)).toHaveAttribute('aria-pressed', 'true')
    expect(sheetHint()).toHaveTextContent(text.hints.delete)
    expect(text.hints.delete).toBe('Click a bar line to remove it.')
    await user.keyboard('v')
    expect(mode(text.modes.move)).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('b')
    expect(mode(text.modes.add)).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not change the mode or undo while the focus is in a text field', async () => {
    const { user } = await setup()

    await user.click(screen.getByLabelText('scratch'))
    await user.keyboard('xb')

    expect(screen.getByLabelText('scratch')).toHaveValue('xb')
    expect(mode(text.modes.move)).toHaveAttribute('aria-pressed', 'true')
  })

  describe('Add bar line', () => {
    it('splits the bar clicked in this part only, renumbers its later bars, and saves it at once', async () => {
      const { user, fakes, map, part, partId } = await setup()
      await user.click(mode(text.modes.add))
      const bar2 = part.bars[1]

      click(page(bar2.pageIndex), bar2.x + bar2.w / 2, bar2.y + 50)

      await waitFor(async () => expect((await saved(fakes)).pages[0].bars).toHaveLength(part.bars.length + 1))
      const after = await saved(fakes)
      expect(after.pages[0].bars[1]).toEqual({ ...bar2, w: bar2.w / 2 })
      expect(after.pages[0].bars[2]).toMatchObject({ bar: 3, x: bar2.x + bar2.w / 2 })
      expect(after.pages[0].bars.at(-1)?.bar).toBe(part.bars.length + 1)
      // Only this part's page layer changed: the timing and the other parts are exactly as they were.
      expect(after.timing).toEqual(map.timing)
      expect(after.pages[1]).toEqual(map.pages[1])
      expect(after.pages[2]).toEqual(map.pages[2])
      expect(after.pages[0].partId).toBe(partId)
      expect(screen.getByRole('button', { name: 'Undo: add bar line after bar 2' })).toBeEnabled()
    })

    it('never calls saveTiming for a bar-line edit', async () => {
      const { user, fakes, part } = await setup()
      const saveTiming = vi.spyOn(fakes.data, 'saveTiming')
      await user.click(mode(text.modes.add))
      const bar2 = part.bars[1]

      click(page(), bar2.x + 100, bar2.y + 50)

      await waitFor(() => expect(screen.getByRole('button', { name: /^Undo: add/ })).toBeEnabled())
      await act(async () => {})
      expect(saveTiming).not.toHaveBeenCalled()
    })

    it('merges the two bars on a click on a bar line (Click a bar line to remove it), saving once and leaving the timing', async () => {
      const { user, fakes, map, part } = await setup()
      const savePageLayer = vi.spyOn(fakes.data, 'savePageLayer')
      const saveTiming = vi.spyOn(fakes.data, 'saveTiming')
      await user.click(mode(text.modes.add))
      const bar21 = part.bars[20]
      const bar22 = part.bars[21]

      fireEvent.pointerMove(page(bar22.pageIndex), { clientX: bar22.x + 3, clientY: bar22.y + 50 })
      expect(document.querySelector('[data-slot="edit-delete-line"]')).toBeInTheDocument()
      click(page(bar22.pageIndex), bar22.x + 3, bar22.y + 50)

      await waitFor(async () => expect((await saved(fakes)).pages[0].bars).toHaveLength(part.bars.length - 1))
      const after = await saved(fakes)
      expect(after.pages[0].bars[20]).toMatchObject({ bar: 21, x: bar21.x, w: bar21.w + bar22.w })
      expect(after.timing).toEqual(map.timing)
      expect(savePageLayer).toHaveBeenCalledTimes(1)
      expect(saveTiming).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Undo: delete bar line after bar 21' })).toBeEnabled()
    })

    it('refuses a split too near the outer edge of a staff line: nothing is recorded or saved, the reason shows for 3 seconds', async () => {
      const { user, fakes, part } = await setup()
      const savePageLayer = vi.spyOn(fakes.data, 'savePageLayer')
      await user.click(mode(text.modes.add))
      const bar1 = part.bars[0]

      click(page(), bar1.x + 5, bar1.y + 50)

      expect(sheetHint()).toHaveTextContent(text.refusals['too-narrow'])
      expect(screen.getByRole('button', { name: strings.history.nothingToUndo })).toBeDisabled()
      expect(savePageLayer).not.toHaveBeenCalled()

      act(() => void vi.advanceTimersByTime(2900))
      expect(sheetHint()).toHaveTextContent(text.refusals['too-narrow'])
      act(() => void vi.advanceTimersByTime(200))
      expect(sheetHint()).toHaveTextContent(text.hints.add)
    })

    it('restarts the 3 seconds when a second edit is refused', async () => {
      const { user, part } = await setup()
      await user.click(mode(text.modes.add))
      const bar1 = part.bars[0]

      click(page(), bar1.x + 4, bar1.y + 50)
      act(() => void vi.advanceTimersByTime(2000))
      click(page(), bar1.x + 5, bar1.y + 50)
      act(() => void vi.advanceTimersByTime(2000))

      expect(sheetHint()).toHaveTextContent(text.refusals['too-narrow'])
      act(() => void vi.advanceTimersByTime(1100))
      expect(sheetHint()).toHaveTextContent(text.hints.add)
    })
  })

  describe('Delete bar line', () => {
    it('merges the two bars at the line clicked, in this part only, and saves it', async () => {
      const { user, fakes, map, part } = await setup()
      await user.click(mode(text.modes.delete))
      const bar2 = part.bars[1]

      click(page(), bar2.x + 3, bar2.y + 50) // the line after bar 1

      await waitFor(async () => expect((await saved(fakes)).pages[0].bars).toHaveLength(part.bars.length - 1))
      const after = await saved(fakes)
      expect(after.pages[0].bars[0]).toMatchObject({ bar: 1, x: part.bars[0].x, w: part.bars[0].w + bar2.w })
      expect(after.timing).toEqual(map.timing)
      expect(after.pages[1]).toEqual(map.pages[1])
      expect(screen.getByRole('button', { name: 'Undo: delete bar line after bar 1' })).toBeEnabled()
    })

    it('does nothing for a click inside a merged bar, where this part has no line', async () => {
      // The trumpet has 63 boxes: the line the OMR missed is not there to delete.
      const { user, part } = await setup(1)
      await user.click(mode(text.modes.delete))
      const wide = part.bars.find((box) => box.w > part.bars[0].w * 1.5)!

      click(page(wide.pageIndex), wide.x + wide.w / 2, wide.y + 50)

      expect(screen.getByRole('button', { name: strings.history.nothingToUndo })).toBeDisabled()
    })
  })

  describe('Move', () => {
    it('drags a bar line and saves the new boxes on release', async () => {
      const { user, fakes, part } = await setup()
      const bar2 = part.bars[1]
      const el = page()

      await user.pointer([
        { keys: '[MouseLeft>]', target: el, coords: { clientX: bar2.x, clientY: bar2.y + 50 } },
        { target: el, coords: { clientX: bar2.x + 40, clientY: bar2.y + 50 } },
      ])
      await user.pointer({ keys: '[/MouseLeft]', target: el, coords: { clientX: bar2.x + 40, clientY: bar2.y + 50 } })

      await waitFor(async () => expect((await saved(fakes)).pages[0].bars[1].x).toBe(bar2.x + 40))
      const after = (await saved(fakes)).pages[0]
      expect(after.bars[0].w).toBe(part.bars[0].w + 40)
      expect(after.bars).toHaveLength(part.bars.length)
      expect(screen.getByRole('button', { name: 'Undo: move bar line after bar 1' })).toBeEnabled()
    })
  })

  describe('Undo and Redo', () => {
    it('restores the doc and saves it, then redoes it and saves that', async () => {
      const { user, fakes, part } = await setup()
      await user.click(mode(text.modes.add))
      const bar2 = part.bars[1]
      click(page(), bar2.x + 100, bar2.y + 50)
      await waitFor(async () => expect((await saved(fakes)).pages[0].bars).toHaveLength(part.bars.length + 1))
      const edited = (await saved(fakes)).pages[0]

      await user.click(screen.getByRole('button', { name: 'Undo: add bar line after bar 2' }))
      await waitFor(async () => expect((await saved(fakes)).pages[0]).toEqual(part))
      expect(screen.getByRole('button', { name: 'Redo: add bar line after bar 2' })).toBeEnabled()

      await user.click(screen.getByRole('button', { name: 'Redo: add bar line after bar 2' }))
      await waitFor(async () => expect((await saved(fakes)).pages[0]).toEqual(edited))
    })

    it('undoes with Cmd+Z and redoes with Shift+Cmd+Z or Ctrl+Y, saving each', async () => {
      const { user, fakes, part } = await setup()
      await user.click(mode(text.modes.add))
      const bar2 = part.bars[1]
      click(page(), bar2.x + 100, bar2.y + 50)
      await waitFor(async () => expect((await saved(fakes)).pages[0].bars).toHaveLength(part.bars.length + 1))
      const edited = (await saved(fakes)).pages[0]

      await user.keyboard('{Meta>}z{/Meta}')
      await waitFor(async () => expect((await saved(fakes)).pages[0]).toEqual(part))
      await user.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}')
      await waitFor(async () => expect((await saved(fakes)).pages[0]).toEqual(edited))

      await user.keyboard('{Control>}z{/Control}')
      await waitFor(async () => expect((await saved(fakes)).pages[0]).toEqual(part))
      await user.keyboard('{Control>}y{/Control}')
      await waitFor(async () => expect((await saved(fakes)).pages[0]).toEqual(edited))
    })

    it('does not undo with Cmd+Z while a text field has focus', async () => {
      const { user, part } = await setup()
      await user.click(mode(text.modes.add))
      const bar2 = part.bars[1]
      click(page(), bar2.x + 100, bar2.y + 50)
      await waitFor(() => expect(screen.getByRole('button', { name: /^Undo: add/ })).toBeEnabled())

      await user.click(screen.getByLabelText('scratch'))
      await user.keyboard('{Meta>}z{/Meta}')

      expect(screen.getByRole('button', { name: /^Undo: add/ })).toBeEnabled()
    })
  })

  describe('the Renumber switch', () => {
    it('is on by default, and saves the choice in the profile settings when turned off and on', async () => {
      const { user, fakes } = await setup()
      const renumber = await screen.findByRole('switch', { name: text.renumber })
      expect(renumber).toBeChecked()

      await user.click(renumber)
      await waitFor(async () => expect((await fakes.data.getProfile()).settings.barLineMode).toBe('plain'))
      expect(screen.getByRole('switch', { name: text.renumber })).not.toBeChecked()

      await user.click(screen.getByRole('switch', { name: text.renumber }))
      await waitFor(async () => expect((await fakes.data.getProfile()).settings.barLineMode).toBe('ripple'))
    })

    it('keeps the other settings when it saves', async () => {
      const { user, fakes } = await setup()

      await user.click(await screen.findByRole('switch', { name: text.renumber }))

      await waitFor(async () => expect((await fakes.data.getProfile()).settings.barLineMode).toBe('plain'))
      expect((await fakes.data.getProfile()).settings.follow.boxColour).toBe('teal')
    })
  })

  describe('when saving fails', () => {
    it('keeps the edit on screen, says Not saved with Retry, and Retry saves it', async () => {
      const { user, fakes, part } = await setup()
      vi.spyOn(fakes.data, 'savePageLayer').mockRejectedValueOnce(new Error('offline'))
      await user.click(mode(text.modes.add))
      const bar2 = part.bars[1]

      click(page(), bar2.x + 100, bar2.y + 50)

      expect(await screen.findByText(text.notSaved)).toBeInTheDocument()
      // The edit stays: it is the step Undo would revert, and the store has not got it.
      expect(screen.getByRole('button', { name: 'Undo: add bar line after bar 2' })).toBeEnabled()
      expect((await saved(fakes)).pages[0]).toEqual(part)

      await user.click(screen.getByRole('button', { name: text.retrySave }))

      await waitFor(() => expect(screen.queryByText(text.notSaved)).toBeNull())
      expect((await saved(fakes)).pages[0].bars).toHaveLength(part.bars.length + 1)
    })

    it('says nothing when everything is saved', async () => {
      await setup()

      expect(screen.queryByText(text.notSaved)).toBeNull()
      expect(screen.queryByRole('button', { name: text.retrySave })).toBeNull()
    })
  })
})
