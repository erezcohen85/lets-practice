import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { type DockEdit, type SlotRef, WaveformDock } from '@/components/waveform/WaveformDock'
import { timeToX } from '@/components/waveform/useDockView'
import { type EditRefusal, type MovedLocator } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { reviewItems } from '@/domain/reviewQueue'
import { type Transport } from '@/lib/useTransport'
import { strings } from '@/strings'

const text = strings.dock
const DURATION = 260
const PEAKS = Array.from({ length: DURATION * 10 }, (_, i) => 0.1 + 0.8 * Math.abs(Math.sin(i / 7)))
const WIDTH = 1000
// The demo doc has locators at 1, 4.6, 8.2, 11.8 s (bars 1 to 4) in the first 12 s window.
const WINDOW = { startSec: 0, spanSec: 12 }
const xOf = (t: number) => timeToX(t, WINDOW, WIDTH)

const transport: Transport = { ready: true, playing: false, timeSec: 0, durationSec: DURATION, error: false, toggle: vi.fn(), seek: vi.fn() }

interface HarnessProps {
  onEdit?: ((edit: DockEdit) => EditRefusal | null) | null
  selected?: SlotRef | null
  moved?: readonly MovedLocator[]
  refusal?: string | null
  onSelectGroup?: (slots: SlotRef[]) => void
  onSelected?: (slot: SlotRef) => void
}

function Harness({ onEdit = () => null, selected: given = null, moved = [], refusal = null, onSelectGroup, onSelected }: HarnessProps) {
  const doc = demoDoc()
  const [own, setOwn] = useState<SlotRef | null>(given)
  return (
    <>
      <input aria-label="elsewhere" />
      <WaveformDock
        peaks={PEAKS}
        durationSec={DURATION}
        timing={doc.timing}
        items={reviewItems({ ...doc, moved }, 'clarinet')}
        moved={moved}
        transport={transport}
        selected={own}
        onSelect={(slot) => {
          setOwn(slot)
          onSelected?.(slot)
        }}
        onSelectGroup={onSelectGroup}
        filter="all"
        onFilterChange={() => {}}
        beatLines={false}
        onBeatLinesChange={() => {}}
        onEdit={onEdit ?? undefined}
        refusal={refusal}
      />
    </>
  )
}

beforeEach(() => {
  vi.mocked(transport.seek).mockClear()
})

const addLocatorButton = () => screen.getByRole('button', { name: text.addLocator })
const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
const preview = () => document.querySelector<HTMLElement>('[data-slot="dock-drag-preview"]')
const down = (t: number, init: object = {}) => fireEvent.pointerDown(stage(), { clientX: xOf(t), clientY: 60, ...init })
const move = (t: number, init: object = {}) => fireEvent.pointerMove(stage(), { clientX: xOf(t), clientY: 60, ...init })
const up = (t: number, init: object = {}) => fireEvent.pointerUp(stage(), { clientX: xOf(t), clientY: 60, ...init })

describe('dragging a locator line', () => {
  it('shows a preview line that follows the pointer and applies the drag once on release', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    down(4.6)
    move(5)
    move(5.2)

    expect(preview()).not.toBeNull()
    expect(preview()!.style.transform).toBe(`translateX(${xOf(5.2)}px)`)
    expect(onEdit).not.toHaveBeenCalled()

    up(5.2)

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith({ kind: 'drag', slot: { bar: 2, passIndex: 0 }, timeSec: expect.closeTo(5.2, 6) })
    expect(preview()).toBeNull()
  })

  it('keeps the preview between the neighbouring locators', () => {
    const onEdit = vi.fn<(edit: DockEdit) => EditRefusal | null>(() => null)
    render(<Harness onEdit={onEdit} />)

    down(4.6)
    move(10)
    up(10)

    const edit = onEdit.mock.calls[0][0] as Extract<DockEdit, { kind: 'drag' }>
    expect(edit.timeSec).toBeLessThan(8.2)
    expect(edit.timeSec).toBeGreaterThan(8)

    down(8.2)
    move(0.2)
    up(0.2)

    const back = onEdit.mock.calls[1][0] as Extract<DockEdit, { kind: 'drag' }>
    expect(back.timeSec).toBeGreaterThan(4.6)
    expect(back.timeSec).toBeLessThan(4.7)
  })

  it('cancels with Escape: nothing is applied and the preview goes', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    down(4.6)
    move(5.2)
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(preview()).toBeNull()
    up(5.2)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('only selects when the line is pressed and released in place', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    down(4.6)
    up(4.6)

    expect(onEdit).not.toHaveBeenCalled()
    expect(document.querySelector('[data-slot="dock-locator"][data-bar="2"]')).toHaveAttribute('data-state', 'selected')
  })

  it('captures the pointer on the stage so a drag that leaves it still ends there', () => {
    const capture = vi.fn()
    render(<Harness />)
    stage().setPointerCapture = capture

    down(4.6, { pointerId: 7 })

    expect(capture).toHaveBeenCalledWith(7)
  })

  it('does nothing without onEdit', () => {
    render(<Harness onEdit={null} />)

    down(4.6)
    move(5.2)

    expect(preview()).toBeNull()
  })
})

describe('clicking empty waveform with Add locator off', () => {
  // Decisions 2026-11-06 (replaces spec 5.4's click-adds): a plain click or a Shift + click moves the play line.
  it('moves the play line to that time and adds nothing', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    down(6)
    up(6)

    expect(transport.seek).toHaveBeenCalledWith(expect.closeTo(6, 6))
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('does the same with Shift', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    down(6, { shiftKey: true })
    up(6, { shiftKey: true })

    expect(transport.seek).toHaveBeenCalledWith(expect.closeTo(6, 6))
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('also seeks when the dock cannot edit (the ruler used to be the only way)', () => {
    render(<Harness onEdit={null} />)

    down(9)
    up(9)

    expect(transport.seek).toHaveBeenCalledWith(expect.closeTo(9, 6))
  })

  it('has no ruler strip and no shortcut strip any more', () => {
    render(<Harness />)

    expect(document.querySelector('[data-slot="dock-ruler"]')).toBeNull()
    expect(document.querySelector('[data-slot="dock-shortcuts"]')).toBeNull()
  })

  it('a press that moves away before release is not a click', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    down(6)
    move(7)
    up(7)

    expect(onEdit).not.toHaveBeenCalled()
    expect(transport.seek).not.toHaveBeenCalled()
  })

  it('a click on a line selects it and neither seeks nor adds', () => {
    const onEdit = vi.fn(() => null)
    const onSelected = vi.fn()
    render(<Harness onEdit={onEdit} onSelected={onSelected} />)

    down(4.6 + 5 / 1000 * 12)
    up(4.6 + 5 / 1000 * 12)

    expect(onSelected).toHaveBeenCalledWith({ bar: 2, passIndex: 0 })
    expect(onEdit).not.toHaveBeenCalled()
    expect(transport.seek).not.toHaveBeenCalled()
  })

  it('a Shift + click on a line still adds it to the selection, without seeking', () => {
    const onSelectGroup = vi.fn()
    render(<Harness selected={{ bar: 1, passIndex: 0 }} onSelectGroup={onSelectGroup} />)

    down(4.6, { shiftKey: true })
    up(4.6, { shiftKey: true })

    expect(onSelectGroup).toHaveBeenCalledWith([{ bar: 1, passIndex: 0 }, { bar: 2, passIndex: 0 }])
    expect(transport.seek).not.toHaveBeenCalled()
  })

  it('a Shift + drag along the label row still selects the lines in the range, without seeking', () => {
    const onSelectGroup = vi.fn()
    render(<Harness onSelectGroup={onSelectGroup} />)

    fireEvent.pointerDown(stage(), { clientX: xOf(3), clientY: 5, shiftKey: true })
    fireEvent.pointerMove(stage(), { clientX: xOf(9), clientY: 5, shiftKey: true })
    fireEvent.pointerUp(stage(), { clientX: xOf(9), clientY: 5, shiftKey: true })

    expect(onSelectGroup).toHaveBeenCalledWith([{ bar: 2, passIndex: 0 }, { bar: 3, passIndex: 0 }])
    expect(transport.seek).not.toHaveBeenCalled()
  })

  it('a Shift + click on the label row away from any line does nothing, as before (it is the start of a range)', () => {
    render(<Harness onSelectGroup={() => {}} />)

    fireEvent.pointerDown(stage(), { clientX: xOf(6), clientY: 5, shiftKey: true })
    fireEvent.pointerUp(stage(), { clientX: xOf(6), clientY: 5, shiftKey: true })

    expect(transport.seek).not.toHaveBeenCalled()
  })

  it('a drag of a line still applies once on release, and does not seek', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    down(4.6)
    move(5.2)
    up(5.2)

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'drag', slot: { bar: 2, passIndex: 0 } }))
    expect(transport.seek).not.toHaveBeenCalled()
  })
})

describe('Add locator', () => {
  it('is a button after the All / Review queue pair with the title "Add locator", off at first, and no key badge', () => {
    render(<Harness />)

    const button = addLocatorButton()
    expect(button).toHaveAttribute('title', 'Add locator')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button.querySelector('kbd')).toBeNull()
    expect(button).toHaveTextContent(/^Add locator$/)
    const filters = screen.getByRole('group', { name: text.locators })
    expect(filters.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(button.compareDocumentPosition(screen.getByText(text.beatLines)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is not offered when the dock cannot edit', () => {
    render(<Harness onEdit={null} />)

    expect(screen.queryByRole('button', { name: text.addLocator })).toBeNull()
  })

  it('on, a click on empty waveform adds a locator at that time and does not seek; the cursor is copy', async () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    await userEvent.click(addLocatorButton())
    expect(addLocatorButton()).toHaveAttribute('aria-pressed', 'true')
    expect(stage()).toHaveClass('cursor-copy')
    down(6)
    up(6)

    expect(onEdit).toHaveBeenCalledWith({ kind: 'add', timeSec: expect.closeTo(6, 6), shift: false })
    expect(transport.seek).not.toHaveBeenCalled()
  })

  it('on, Shift + click passes Shift on, which turns the Renumber setting round', async () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    await userEvent.click(addLocatorButton())
    down(6, { shiftKey: true })
    up(6, { shiftKey: true })

    expect(onEdit).toHaveBeenCalledWith({ kind: 'add', timeSec: expect.closeTo(6, 6), shift: true })
  })

  it('on, a click on a line still only selects it', async () => {
    const onEdit = vi.fn(() => null)
    const onSelected = vi.fn()
    render(<Harness onEdit={onEdit} onSelected={onSelected} />)

    await userEvent.click(addLocatorButton())
    down(4.6)
    up(4.6)

    expect(onSelected).toHaveBeenCalled()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('is turned off by pressing the button again; the cursor goes back', async () => {
    render(<Harness />)

    await userEvent.click(addLocatorButton())
    await userEvent.click(addLocatorButton())

    expect(addLocatorButton()).toHaveAttribute('aria-pressed', 'false')
    expect(stage()).not.toHaveClass('cursor-copy')
  })

  it('L toggles it from anywhere outside a text field, and Esc turns it off', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.keyboard('l')
    expect(addLocatorButton()).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('L')
    expect(addLocatorButton()).toHaveAttribute('aria-pressed', 'false')
    await user.keyboard('l{Escape}')
    expect(addLocatorButton()).toHaveAttribute('aria-pressed', 'false')
  })

  it('L is ignored while a text field has focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('textbox', { name: 'elsewhere' }))
    await user.keyboard('l')

    expect(addLocatorButton()).toHaveAttribute('aria-pressed', 'false')
  })

  it('the first Esc turns it off and leaves the selection; the next one clears the selection', async () => {
    const user = userEvent.setup()
    const onSelectGroup = vi.fn()
    render(<Harness selected={{ bar: 2, passIndex: 0 }} onSelectGroup={onSelectGroup} />)

    await user.keyboard('l{Escape}')
    expect(addLocatorButton()).toHaveAttribute('aria-pressed', 'false')
    expect(onSelectGroup).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onSelectGroup).toHaveBeenCalledWith([])
  })

  it('does not respond to L when the dock cannot edit', async () => {
    const user = userEvent.setup()
    render(<Harness onEdit={null} />)

    await user.keyboard('l')

    expect(screen.queryByRole('button', { name: text.addLocator })).toBeNull()
  })
})

describe('the transport row text', () => {
  it('says nothing over the waveform, with Add locator off or on: no hint, only a refusal', async () => {
    render(<Harness />)
    fireEvent.pointerEnter(stage())
    expect(document.querySelector('section[aria-label="Waveform"] p')).toBeNull()

    await userEvent.click(addLocatorButton())
    fireEvent.pointerEnter(stage())
    expect(document.querySelector('section[aria-label="Waveform"] p')).toBeNull()
  })

  it('does not show a selected locator\'s old hint either', () => {
    render(<Harness selected={{ bar: 2, passIndex: 0 }} />)

    expect(screen.queryByText(/Drag the bar/)).toBeNull()
  })

  it('shows a refusal in full (it wraps, it is not cut off) and nothing else', () => {
    const long = 'No bar is free between the neighbouring locators. Add it with the later bars moving on instead (the Renumber switch, or Shift for one click).'
    render(<Harness refusal={long} />)

    const message = screen.getByText(long)
    expect(message).toHaveAttribute('role', 'status')
    expect(message).not.toHaveClass('truncate')
  })
})

describe('Delete and Backspace', () => {
  it('Delete removes the selected locator without a ripple, Shift+Delete with one', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} selected={{ bar: 3, passIndex: 0 }} />)

    await user.keyboard('{Delete}')
    await user.keyboard('{Shift>}{Delete}{/Shift}')

    expect(onEdit).toHaveBeenNthCalledWith(1, { kind: 'delete', slot: { bar: 3, passIndex: 0 }, shift: false })
    expect(onEdit).toHaveBeenNthCalledWith(2, { kind: 'delete', slot: { bar: 3, passIndex: 0 }, shift: true })
  })

  it('Backspace and Shift+Backspace do the same', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} selected={{ bar: 3, passIndex: 0 }} />)

    await user.keyboard('{Backspace}')
    await user.keyboard('{Shift>}{Backspace}{/Shift}')

    expect(onEdit).toHaveBeenNthCalledWith(1, { kind: 'delete', slot: { bar: 3, passIndex: 0 }, shift: false })
    expect(onEdit).toHaveBeenNthCalledWith(2, { kind: 'delete', slot: { bar: 3, passIndex: 0 }, shift: true })
  })

  it('is ignored while a text field has focus', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} selected={{ bar: 3, passIndex: 0 }} />)

    await user.click(screen.getByRole('textbox', { name: 'elsewhere' }))
    await user.keyboard('ab{Backspace}{Delete}')

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('is ignored with no selection', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    await user.keyboard('{Delete}')

    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('relabelling by typing a bar number', () => {
  const field = () => screen.getByRole('textbox', { name: text.relabelField })

  it('Enter on the selected line opens a field with its label', async () => {
    const user = userEvent.setup()
    render(<Harness selected={{ bar: 9, passIndex: 1 }} />)
    stage().focus()

    await user.keyboard('{Enter}')

    expect(field()).toHaveValue('9 (2)')
    expect(field()).toHaveFocus()
  })

  it('a double click on a line opens it too', () => {
    render(<Harness selected={{ bar: 2, passIndex: 0 }} />)

    fireEvent.doubleClick(stage(), { clientX: xOf(4.6), clientY: 60 })

    expect(field()).toHaveValue('2')
  })

  it('Enter in the field applies the typed label: "5" is bar 5, "9 (2)" is bar 9 second pass', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} selected={{ bar: 2, passIndex: 0 }} />)
    stage().focus()
    await user.keyboard('{Enter}')

    await user.clear(field())
    await user.type(field(), '5{Enter}')

    expect(onEdit).toHaveBeenCalledWith({ kind: 'relabel', slot: { bar: 2, passIndex: 0 }, bar: 5, passIndex: 0 })
    expect(screen.queryByRole('textbox', { name: text.relabelField })).toBeNull()
  })

  it('reads the pass in parentheses as 1-based on screen', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} selected={{ bar: 2, passIndex: 0 }} />)
    stage().focus()
    await user.keyboard('{Enter}')

    await user.clear(field())
    await user.type(field(), '9 (2){Enter}')

    expect(onEdit).toHaveBeenCalledWith({ kind: 'relabel', slot: { bar: 2, passIndex: 0 }, bar: 9, passIndex: 1 })
  })

  it('shows an error under the field and applies nothing for text that is not a label', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} selected={{ bar: 2, passIndex: 0 }} />)
    stage().focus()
    await user.keyboard('{Enter}')

    await user.clear(field())
    await user.type(field(), 'abc{Enter}')

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(text.relabelInvalid)
    expect(field()).toBeInTheDocument()
  })

  it('shows an error and keeps the field when the label is not a slot of the play order', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn((): EditRefusal | null => 'out-of-range')
    render(<Harness onEdit={onEdit} selected={{ bar: 2, passIndex: 0 }} />)
    stage().focus()
    await user.keyboard('{Enter}')

    await user.clear(field())
    await user.type(field(), '999{Enter}')

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent(text.relabelUnknown)
    expect(field()).toBeInTheDocument()
  })

  it('Escape closes it and applies nothing', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} selected={{ bar: 2, passIndex: 0 }} />)
    stage().focus()
    await user.keyboard('{Enter}')

    await user.type(field(), '7{Escape}')

    expect(screen.queryByRole('textbox', { name: text.relabelField })).toBeNull()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('does not let Delete or Space reach the dock while the field has focus', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} selected={{ bar: 2, passIndex: 0 }} />)
    stage().focus()
    await user.keyboard('{Enter}')

    await user.keyboard('{Backspace}{Delete} ')

    expect(onEdit).not.toHaveBeenCalled()
    expect(transport.toggle).not.toHaveBeenCalled()
  })
})

describe('the moved tags', () => {
  it('names each moved locator with its signed offset to two decimals', () => {
    // Bar 3 sits at 8.2 s now; it was at 7.78 s, and bar 4 (11.8 s) was at 11.92 s.
    render(
      <Harness
        moved={[
          { bar: 3, passIndex: 0, fromSec: 7.78, wasConfirmed: false },
          { bar: 4, passIndex: 0, fromSec: 11.92, wasConfirmed: false },
        ]}
      />,
    )

    expect(screen.getByText(text.movedTag('3', '+0.42'))).toBeInTheDocument()
    expect(screen.getByText(text.movedTag('4', '-0.12'))).toBeInTheDocument()
    expect(text.movedTag('3', '+0.42')).toBe('Bar 3 · moved +0.42 s')
  })

  it('has no tag when nothing was moved', () => {
    render(<Harness />)

    expect(document.querySelector('[data-slot="dock-moved-tag"]')).toBeNull()
  })
})
