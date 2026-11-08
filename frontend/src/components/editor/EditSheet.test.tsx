import { hintOf } from '@/components/ui/hint'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { strings } from '@/strings'
import { initialPieceEditing } from '@/domain/pieceEditing'
import { EditSheet, type EditSheetProps } from './EditSheet'

const PIECE_OFF = {
  state: initialPieceEditing,
  asking: false,
  requestOn: () => {},
  cancelRequest: () => {},
  turnOn: () => {},
  turnOff: () => {},
  action: () => {},
  keep: () => {},
}
const PIECE_ON = {
  state: { ...initialPieceEditing, on: true, lastActionMs: 0 },
  asking: false,
  requestOn: () => {},
  cancelRequest: () => {},
  turnOn: () => {},
  turnOff: () => {},
  action: () => {},
  keep: () => {},
}
const SHEET_EXTRAS = { pieceEditing: PIECE_OFF, partName: 'Flute', barsInBox: null, pickupBar: null, zoomPercent: 100 }

const text = strings.editor

function setup(props: Partial<EditSheetProps> = {}) {
  const handlers = {
    onModeChange: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
  }
  const user = userEvent.setup()
  const view = render(<EditSheet mode="move" undoLabel={null} redoLabel={null} {...SHEET_EXTRAS} {...handlers} {...props} />)
  return { user, ...handlers, ...view }
}

describe('EditSheet', () => {
  it('names the sheet "Edit bar lines" and shows the tools as Move, Add and Delete, with no key badges', () => {
    setup()

    expect(screen.getByText(text.sheet)).toBeInTheDocument()
    expect(text.sheet).toBe('Edit bar lines')
    for (const [value, key, label] of [['move', 'V', 'Move'], ['add', 'B', 'Add'], ['delete', 'X', 'Delete']] as const) {
      const button = screen.getByRole('button', { name: text.modes[value] })
      expect(button).toHaveTextContent(label)
      // The key stays for assistive technology, but is not drawn and is not in the hover text.
      expect(button).toHaveAttribute('aria-keyshortcuts', key)
      expect(hintOf(button)).toBe(text.modes[value])
      expect(button.querySelector('kbd')).toBeNull()
    }
    expect(text.modes).toEqual({ move: 'Move bar lines', add: 'Add a bar line', delete: 'Delete a bar line' })
  })

  it('marks the active mode pressed and the others not', () => {
    setup({ mode: 'add' })

    expect(screen.getByRole('button', { name: text.modes.add })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: text.modes.move })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: text.modes.delete })).toHaveAttribute('aria-pressed', 'false')
  })

  it('asks for the mode a click names', async () => {
    const { user, onModeChange } = setup()

    await user.click(screen.getByRole('button', { name: text.modes.delete }))
    await user.click(screen.getByRole('button', { name: text.modes.add }))

    expect(onModeChange.mock.calls).toEqual([['delete'], ['add']])
  })

  it('disables Undo and Redo with nothing to undo or redo, and says so in their tooltips', () => {
    setup()

    const undo = screen.getByRole('button', { name: strings.history.nothingToUndo })
    const redo = screen.getByRole('button', { name: strings.history.nothingToRedo })
    expect(undo).toBeDisabled()
    expect(redo).toBeDisabled()
    expect(hintOf(undo)).toBe(strings.history.nothingToUndo)
  })

  it('names the step in the Undo and Redo tooltips and calls back when they are pressed', async () => {
    const { user, onUndo, onRedo } = setup({
      undoLabel: { kind: 'add-bar-line', bar: 12 },
      redoLabel: { kind: 'move-bar-line', bar: 3 },
    })

    const undo = screen.getByRole('button', { name: 'Undo: add bar line after bar 12' })
    const redo = screen.getByRole('button', { name: 'Redo: move bar line after bar 3' })
    expect(hintOf(undo)).toBe('Undo: add bar line after bar 12')
    await user.click(undo)
    await user.click(redo)

    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
  })

  describe('Bars in box', () => {
    const group = () => screen.getByRole('group', { name: text.pieceEditing.barsInBox })

    it('is always on the sheet, off with no bar selected, with the tooltip as drawn', () => {
      setup()

      expect(text.pieceEditing.barsInBox).toBe('Bars in box')
      expect(hintOf(within(group()).getByRole('spinbutton'))).toBe('How many bars this box holds. More than 1 makes it a multi-rest.')
      expect(hintOf(within(group()).getByRole('button', { name: text.pieceEditing.fewer }))).toBe(text.pieceEditing.fewer)
      expect(within(group()).getByRole('button', { name: text.pieceEditing.fewer })).toBeDisabled()
      expect(within(group()).getByRole('button', { name: text.pieceEditing.more })).toBeDisabled()
      expect(within(group()).getByRole('spinbutton')).toBeDisabled()
      expect(within(group()).getByRole('spinbutton')).toHaveValue(1)
    })

    it('sits right after the tools, before Undo and Redo', () => {
      setup()

      const tools = screen.getByRole('button', { name: text.modes.delete })
      const redo = screen.getByRole('button', { name: strings.history.nothingToRedo })
      expect(tools.compareDocumentPosition(group()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(group().compareDocumentPosition(redo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('works on the selected bar: steps and typed numbers go to onChange; more than one bar is teal', async () => {
      const onChange = vi.fn()
      const { user, rerender } = setup({ barsInBox: { count: 3, onChange } })

      const field = within(group()).getByRole('spinbutton')
      expect(field).toHaveValue(3)
      expect(field).toHaveClass('text-primary-strong')
      await user.click(within(group()).getByRole('button', { name: text.pieceEditing.more }))
      await user.click(within(group()).getByRole('button', { name: text.pieceEditing.fewer }))
      await user.clear(field)
      await user.type(field, '6{Enter}')
      expect(onChange.mock.calls).toEqual([[4], [2], [6]])

      rerender(<EditSheet mode="move" undoLabel={null} redoLabel={null} {...SHEET_EXTRAS} onModeChange={() => {}} onUndo={() => {}} onRedo={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} barsInBox={{ count: 1, onChange }} />)
      expect(within(group()).getByRole('spinbutton')).not.toHaveClass('text-primary-strong')
      expect(within(group()).getByRole('button', { name: text.pieceEditing.fewer })).toBeDisabled()
    })
  })

  describe('Edit piece', () => {
    it('shows "Edit piece" and keeps the full name on the switch, which is red when on', () => {
      const { rerender } = setup()
      const off = screen.getByRole('switch', { name: text.pieceEditing.switch })

      expect(screen.getByText(text.pieceEditing.switchShort)).toBeInTheDocument()
      expect(off).not.toBeChecked()

      rerender(<EditSheet mode="move" undoLabel={null} redoLabel={null} {...SHEET_EXTRAS} pieceEditing={PIECE_ON} onModeChange={() => {}} onUndo={() => {}} onRedo={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} />)
      const on = screen.getByRole('switch', { name: text.pieceEditing.switch })
      expect(on).toBeChecked()
      expect(on).toHaveAttribute('data-tone', 'danger')
      expect(screen.getByText(text.pieceEditing.switchShort)).toHaveClass('text-problem')
    })

    it('has no Renumber switch and no amber band, also while it is on (Renumber lives on the waveform and in Structure)', () => {
      setup({ pieceEditing: PIECE_ON })

      const sheet = screen.getByRole('region', { name: text.sheet })
      expect(sheet.children).toHaveLength(1)
      expect(screen.queryByRole('switch', { name: text.renumber })).toBeNull()
      expect(sheet).not.toHaveTextContent(text.renumber)
      expect(sheet.querySelector('[data-slot="piece-band"]')).toBeNull()
      expect(sheet).not.toHaveTextContent('Editing the piece structure')
    })
  })

  describe('Zoom', () => {
    it('is the last control of the row: label, minus, the percent, plus', async () => {
      const { user, onZoomIn, onZoomOut } = setup({ zoomPercent: 125 })

      const zoomIn = screen.getByRole('button', { name: strings.score.zoomIn })
      expect(screen.getByText(strings.score.zoomLabel)).toBeInTheDocument()
      expect(strings.score.zoomLabel).toBe('Zoom')
      expect(screen.getByText('125%')).toBeInTheDocument()
      await user.click(zoomIn)
      await user.click(screen.getByRole('button', { name: strings.score.zoomOut }))
      expect(onZoomIn).toHaveBeenCalledTimes(1)
      expect(onZoomOut).toHaveBeenCalledTimes(1)

      const piece = screen.getByRole('switch', { name: text.pieceEditing.switch })
      expect(piece.compareDocumentPosition(zoomIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  it('is one row with no hint of its own', () => {
    setup()

    const sheet = screen.getByRole('region', { name: text.sheet })
    expect(sheet.children).toHaveLength(1)
    expect(sheet.querySelector('[role="status"]')).toBeNull()
  })

  it('is a container and stays on one row as long as it can: it compacts, then goes to two deliberate rows (it no longer wraps by itself)', () => {
    setup()

    const sheet = screen.getByRole('region', { name: text.sheet })
    expect(sheet).toHaveClass('@container')
    const row = sheet.firstElementChild!
    expect(row).not.toHaveClass('flex-wrap')
    expect(row).toHaveClass('@max-[679px]:flex-col')
  })

  // Compacting is by the width of the bar (container queries, which jsdom does not lay out): what the test can hold is that every
  // word that goes is still in the page for assistive technology, and that every control keeps its name.
  it('keeps every name when the words go: they are screen-reader text, not removed', () => {
    setup({ barsInBox: { count: 1, onChange: () => {} } })

    expect(screen.getByText(text.sheet)).toHaveClass('@max-[1124px]:sr-only')
    expect(screen.getByText(strings.score.zoomLabel)).toHaveClass('@max-[1018px]:sr-only')
    expect(screen.getByText(text.pieceEditing.barsInBox)).toHaveClass('@max-[974px]:sr-only')
    for (const value of ['move', 'add', 'delete'] as const) {
      const button = screen.getByRole('button', { name: text.modes[value] })
      expect(within(button).getByText(text.modeLabels[value])).toHaveClass('@max-[822px]:sr-only')
      expect(hintOf(button)).toBe(text.modes[value])
      expect(button).toHaveClass('@max-[822px]:w-9')
    }
    expect(hintOf(screen.getByRole('spinbutton', { name: text.pieceEditing.barsInBox }))).toBe(text.pieceEditing.barsInBoxTip)
    expect(screen.getByRole('spinbutton', { name: text.pieceEditing.barsInBox })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.pieceEditing.fewer })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.pieceEditing.more })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.score.zoomIn })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.score.zoomOut })).toBeInTheDocument()
  })

  it('goes to two rows last, with no divider at the start of the second', () => {
    setup()

    const row = screen.getByRole('region', { name: text.sheet }).firstElementChild as HTMLElement
    expect(row).toHaveClass('@max-[679px]:flex-col')
    expect(screen.getByRole('switch', { name: text.pieceEditing.switch }).closest('[data-slot="hint"]')!.parentElement).toHaveClass('@max-[679px]:border-s-0')
  })
})

describe('the pickup bar toggle', () => {
  const toggle = () => screen.getByRole('switch', { name: text.pickupBar.label })

  it('is off and cannot be used with no bar selected', () => {
    setup()
    expect(toggle()).toHaveAttribute('aria-disabled', 'true')
    expect(toggle()).not.toBeChecked()
  })

  it('shows whether the selected bar is a pickup, and calls back on a press', async () => {
    const onToggle = vi.fn()
    const { user } = setup({ pickupBar: { on: true, onToggle } })
    expect(toggle()).toBeEnabled()
    expect(toggle()).toBeChecked()
    await user.click(toggle())
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('names itself in words as well as with the switch, and the word is screen-reader text when narrow', () => {
    setup({ pickupBar: { on: false, onToggle: () => {} } })
    expect(screen.getByText(text.pickupBar.short)).toBeInTheDocument()
    expect(screen.getByText(text.pickupBar.short)).toHaveClass('@max-[897px]:sr-only')
    expect(hintOf(toggle())).toBe(text.pickupBar.tip)
  })
})
