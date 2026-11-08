import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { type DockEdit, type SlotRef, WaveformDock } from '@/components/waveform/WaveformDock'
import { timeToX } from '@/components/waveform/useDockView'
import { type DetectedBeat } from '@/domain/beats'
import { type EditRefusal } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { reviewItems } from '@/domain/reviewQueue'
import { type Transport } from '@/lib/useTransport'
import { strings } from '@/strings'

const text = strings.dock
const DURATION = 260
const PEAKS = Array.from({ length: DURATION * 10 }, (_, i) => 0.1 + 0.8 * Math.abs(Math.sin(i / 7)))
const WIDTH = 1000
// The demo doc has locators at 1, 4.6, 8.2, 11.8 s (bars 1 to 4) in the first 12 s window; bar 5 is at 15.4 s.
const WINDOW = { startSec: 0, spanSec: 12 }
const xOf = (t: number) => timeToX(t, WINDOW, WIDTH)

const transport: Transport = { ready: true, playing: false, timeSec: 0, durationSec: DURATION, error: false, toggle: vi.fn(), seek: vi.fn() }
beforeEach(() => {
  vi.mocked(transport.seek).mockClear()
})
const bar = (n: number): SlotRef => ({ bar: n, passIndex: 0 })
// A beat 0.3 s after each bar line.
const BEATS: DetectedBeat[] = [1.3, 4.9, 8.5, 12.1, 15.7].map((t) => ({ t, downbeat: 0.1 }))

/** The page's side of the selection: one selected line, plus the group when there are several. The first of them is the selected one, so the window stays on the first 12 s. */
function Harness({
  start = [bar(2)],
  beats = BEATS,
  onEdit = () => null,
  onSelectGroup,
}: {
  start?: SlotRef[]
  beats?: DetectedBeat[]
  onEdit?: (edit: DockEdit) => EditRefusal | null
  onSelectGroup?: (slots: SlotRef[]) => void
}) {
  const doc = demoDoc()
  const [slots, setSlots] = useState<SlotRef[]>(start)
  const choose = (next: SlotRef[]) => {
    onSelectGroup?.(next)
    setSlots(next)
  }
  return (
    <WaveformDock
      peaks={PEAKS}
      durationSec={DURATION}
      timing={doc.timing}
      beats={beats}
      items={reviewItems(doc, 'clarinet')}
      moved={[]}
      transport={transport}
      selected={slots[0] ?? null}
      onSelect={(slot) => setSlots([slot])}
      group={slots.length > 1 ? slots : []}
      onSelectGroup={choose}
      filter="all"
      onFilterChange={() => {}}
      beatLines={false}
      onBeatLinesChange={() => {}}
      onEdit={onEdit}
    />
  )
}

const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
const LINE_Y = 60
const LABEL_Y = 5
const down = (t: number, init: object = {}, y = LINE_Y) => fireEvent.pointerDown(stage(), { clientX: xOf(t), clientY: y, ...init })
const move = (t: number, init: object = {}, y = LINE_Y) => fireEvent.pointerMove(stage(), { clientX: xOf(t), clientY: y, ...init })
const up = (t: number, init: object = {}, y = LINE_Y) => fireEvent.pointerUp(stage(), { clientX: xOf(t), clientY: y, ...init })
const SHIFT = { shiftKey: true }
const selectedBars = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="dock-locator"][data-state="selected"]')].map((element) => Number(element.dataset.bar))
const editSpy = () => vi.fn<(edit: DockEdit) => EditRefusal | null>(() => null)
const lastGroupDrag = (onEdit: ReturnType<typeof editSpy>) => onEdit.mock.calls.at(-1)![0] as Extract<DockEdit, { kind: 'drag-group' }>

describe('choosing several locators', () => {
  it('Shift + click adds a line to the selection', () => {
    const onSelectGroup = vi.fn()
    render(<Harness onSelectGroup={onSelectGroup} />)
    down(8.2, SHIFT)
    up(8.2, SHIFT)
    expect(onSelectGroup).toHaveBeenLastCalledWith([bar(2), bar(3)])
    expect(selectedBars()).toEqual([2, 3])
  })

  it('Shift + click on a chosen line takes it out again', () => {
    const onSelectGroup = vi.fn()
    render(<Harness start={[bar(2), bar(3), bar(4)]} onSelectGroup={onSelectGroup} />)
    down(8.2, SHIFT)
    up(8.2, SHIFT)
    expect(onSelectGroup).toHaveBeenLastCalledWith([bar(2), bar(4)])
    expect(selectedBars()).toEqual([2, 4])
  })

  it('Shift + click never adds a locator or starts a drag', () => {
    const onEdit = editSpy()
    render(<Harness onEdit={onEdit} />)
    down(8.2, SHIFT)
    move(9, SHIFT)
    up(9, SHIFT)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('Shift + click on the empty waveform moves the play line like a plain click (Add locator off), and does not choose anything', () => {
    const onEdit = editSpy()
    const onSelectGroup = vi.fn()
    render(<Harness onEdit={onEdit} onSelectGroup={onSelectGroup} />)
    down(6.5, SHIFT)
    up(6.5, SHIFT)
    expect(transport.seek).toHaveBeenCalledWith(expect.closeTo(6.5, 3))
    expect(onEdit).not.toHaveBeenCalled()
    expect(onSelectGroup).not.toHaveBeenCalled()
  })

  it('with Add locator on, Shift + click on the empty waveform still adds the other way round (UX part 10), and does not choose anything', async () => {
    const onEdit = editSpy()
    const onSelectGroup = vi.fn()
    render(<Harness onEdit={onEdit} onSelectGroup={onSelectGroup} />)
    await userEvent.click(screen.getByRole('button', { name: text.addLocator }))
    down(6.5, SHIFT)
    up(6.5, SHIFT)
    expect(onEdit).toHaveBeenCalledWith({ kind: 'add', timeSec: expect.closeTo(6.5, 3), shift: true })
    expect(onSelectGroup).not.toHaveBeenCalled()
  })

  it('Shift + click on empty space in the label row adds nothing', () => {
    const onEdit = editSpy()
    render(<Harness onEdit={onEdit} />)
    down(6.5, SHIFT, LABEL_Y)
    up(6.5, SHIFT, LABEL_Y)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('a click without Shift on a line outside the group makes it the only one chosen', () => {
    render(<Harness start={[bar(2), bar(3)]} />)
    down(11.8)
    up(11.8)
    expect(selectedBars()).toEqual([4])
  })

  it('Shift + drag along the label row chooses every line in the range', () => {
    const onSelectGroup = vi.fn()
    render(<Harness start={[bar(1)]} onSelectGroup={onSelectGroup} />)
    down(3, SHIFT, LABEL_Y)
    move(6, SHIFT, LABEL_Y)
    expect(document.querySelector('[data-slot="dock-range-preview"]')).not.toBeNull()
    move(9, SHIFT, LABEL_Y)
    up(9, SHIFT, LABEL_Y)
    expect(onSelectGroup).toHaveBeenLastCalledWith([bar(2), bar(3)])
    expect(selectedBars()).toEqual([2, 3])
    expect(document.querySelector('[data-slot="dock-range-preview"]')).toBeNull()
  })

  it('Shift + drag backwards along the label row chooses the same lines', () => {
    const onSelectGroup = vi.fn()
    render(<Harness onSelectGroup={onSelectGroup} />)
    down(9, SHIFT, LABEL_Y)
    move(3, SHIFT, LABEL_Y)
    up(3, SHIFT, LABEL_Y)
    expect(onSelectGroup).toHaveBeenLastCalledWith([bar(2), bar(3)])
  })

  it('a Shift + drag over no line leaves the selection alone', () => {
    const onSelectGroup = vi.fn()
    render(<Harness onSelectGroup={onSelectGroup} />)
    down(5, SHIFT, LABEL_Y)
    move(7, SHIFT, LABEL_Y)
    up(7, SHIFT, LABEL_Y)
    expect(onSelectGroup).not.toHaveBeenCalled()
  })

  it('Escape clears the selection', async () => {
    const onSelectGroup = vi.fn()
    const user = userEvent.setup()
    render(<Harness start={[bar(2), bar(3)]} onSelectGroup={onSelectGroup} />)
    await user.keyboard('{Escape}')
    expect(onSelectGroup).toHaveBeenLastCalledWith([])
    expect(selectedBars()).toEqual([])
  })

  it('shows how many lines are chosen in the dock when it is given the hint', () => {
    render(<Harness start={[bar(2), bar(3)]} />)
    expect(selectedBars()).toEqual([2, 3])
    expect(document.querySelectorAll('[data-slot="dock-selected-span"]')).toHaveLength(2)
  })
})

describe('dragging several locators', () => {
  it('moves them all by the offset of the pressed one, as one edit', () => {
    const onEdit = editSpy()
    render(<Harness start={[bar(2), bar(3)]} onEdit={onEdit} />)
    down(4.6)
    move(5.1, SHIFT)
    expect(document.querySelectorAll('[data-slot="dock-drag-preview"]')).toHaveLength(2)
    up(5.1, SHIFT)
    expect(onEdit).toHaveBeenCalledTimes(1)
    const edit = lastGroupDrag(onEdit)
    expect(edit.kind).toBe('drag-group')
    expect(edit.slots).toEqual([bar(2), bar(3)])
    expect(edit.deltaSec).toBeCloseTo(0.5, 1)
  })

  it('stops at the first neighbour that is not chosen', () => {
    const onEdit = editSpy()
    render(<Harness start={[bar(2), bar(3)]} onEdit={onEdit} />)
    down(8.2)
    move(11.9, SHIFT)
    up(11.9, SHIFT)
    // Bar 4 at 11.8 is the neighbour of bar 3: the group stops 0.01 s before it.
    expect(lastGroupDrag(onEdit).deltaSec).toBeCloseTo(11.8 - 0.01 - 8.2, 2)
  })

  it('lands the pressed line on a beat near the pointer, the others keeping their distance to it', () => {
    const onEdit = editSpy()
    render(<Harness start={[bar(2), bar(3)]} onEdit={onEdit} />)
    down(4.6)
    // 4.9 is a beat: a pointer at 4.88 takes it.
    move(4.88)
    up(4.88)
    expect(lastGroupDrag(onEdit).deltaSec).toBeCloseTo(0.3, 5)
  })

  it('a press on a chosen line without a move keeps nothing but that line chosen, and edits nothing', () => {
    const onEdit = editSpy()
    render(<Harness start={[bar(2), bar(3)]} onEdit={onEdit} />)
    down(4.6)
    up(4.6)
    expect(onEdit).not.toHaveBeenCalled()
    expect(selectedBars()).toEqual([2])
  })

  it('keeps the whole group chosen after it was dragged', () => {
    render(<Harness start={[bar(2), bar(3)]} />)
    down(4.6)
    move(5.1, SHIFT)
    up(5.1, SHIFT)
    expect(selectedBars()).toEqual([2, 3])
  })

  it('a single chosen line still drags alone', () => {
    const onEdit = editSpy()
    render(<Harness start={[bar(2)]} onEdit={onEdit} />)
    down(4.6)
    move(5.1, SHIFT)
    up(5.1, SHIFT)
    expect(onEdit.mock.calls.at(-1)![0].kind).toBe('drag')
  })

  it('Escape in the middle of a drag cancels it and keeps the group', async () => {
    const onEdit = editSpy()
    const user = userEvent.setup()
    render(<Harness start={[bar(2), bar(3)]} onEdit={onEdit} />)
    down(4.6)
    move(5.1, SHIFT)
    await user.keyboard('{Escape}')
    up(5.1, SHIFT)
    expect(onEdit).not.toHaveBeenCalled()
    expect(selectedBars()).toEqual([2, 3])
  })
})

describe('snapping several locators', () => {
  it('asks for each line to go to its own next beat', async () => {
    const onEdit = editSpy()
    const user = userEvent.setup()
    render(<Harness start={[bar(2), bar(3)]} onEdit={onEdit} />)
    await user.click(screen.getByRole('button', { name: text.snapNext }))
    const edit = onEdit.mock.calls.at(-1)![0] as Extract<DockEdit, { kind: 'snap-group' }>
    expect(edit).toMatchObject({ kind: 'snap-group', direction: 'next', slots: [bar(2), bar(3)] })
    expect(edit.beats).toBe(BEATS)
  })

  it('the closest beat snaps the group too, on the button and on the key /', async () => {
    const onEdit = editSpy()
    const user = userEvent.setup()
    render(<Harness onEdit={onEdit} start={[bar(2), bar(3)]} beats={[{ t: 4.5, downbeat: 0.1 }, { t: 8.3, downbeat: 0.1 }]} />)
    await user.click(screen.getByRole('button', { name: text.snapClosest }))
    expect(onEdit.mock.calls.at(-1)![0]).toMatchObject({ kind: 'snap-group', direction: 'closest', slots: [bar(2), bar(3)] })
    onEdit.mockClear()
    fireEvent.keyDown(window, { key: '/' })
    expect(onEdit.mock.calls.at(-1)![0]).toMatchObject({ kind: 'snap-group', direction: 'closest' })
  })

  it('the keys , and . snap the group too', async () => {
    const onEdit = editSpy()
    const user = userEvent.setup()
    render(<Harness start={[bar(2), bar(3)]} onEdit={onEdit} />)
    await user.keyboard(',')
    expect(onEdit.mock.calls.at(-1)![0]).toMatchObject({ kind: 'snap-group', direction: 'previous' })
  })

  it('is on while at least one line of the group has a beat that way', () => {
    render(<Harness start={[bar(1), bar(2)]} />)
    // The first beat is at 1.3 s: bar 1 has none before it, bar 2 has.
    expect(screen.getByRole('button', { name: text.snapPrevious })).toBeEnabled()
    expect(screen.getByRole('button', { name: text.snapNext })).toBeEnabled()
  })

  it('is off when no line of the group could snap that way', () => {
    // The one beat is at 20 s: nothing before it, and the way to it is blocked by the lines that are not chosen.
    render(<Harness start={[bar(1), bar(2)]} beats={[{ t: 20, downbeat: 0.1 }]} />)
    expect(screen.getByRole('button', { name: text.snapPrevious })).toBeDisabled()
    expect(screen.getByRole('button', { name: text.snapNext })).toBeDisabled()
  })
})

// Task 16: a drag that starts on empty waveform draws a band; the lines inside it become the same selection Shift + click makes.
describe('the selection band', () => {
  const band = () => document.querySelector('[data-slot="dock-band"]')

  it('draws a box while dragging, shows the lines inside as selected, and selects them on release', () => {
    const onSelectGroup = vi.fn()
    const onEdit = editSpy()
    render(<Harness start={[bar(1)]} onSelectGroup={onSelectGroup} onEdit={onEdit} />)
    down(3)
    move(6)
    expect(band()).not.toBeNull()
    expect(selectedBars()).toEqual([2])
    move(10)
    expect(selectedBars()).toEqual([2, 3])
    up(10)
    expect(band()).toBeNull()
    expect(onSelectGroup).toHaveBeenLastCalledWith([bar(2), bar(3)])
    expect(selectedBars()).toEqual([2, 3])
    expect(onEdit).not.toHaveBeenCalled()
    expect(transport.seek).not.toHaveBeenCalled()
  })

  it('a band with nothing inside clears the selection', () => {
    render(<Harness start={[bar(2), bar(3)]} />)
    down(5)
    move(6)
    expect(selectedBars()).toEqual([])
    up(6)
    expect(selectedBars()).toEqual([])
  })

  it('Shift adds to the current selection', () => {
    render(<Harness start={[bar(1)]} />)
    down(7, SHIFT)
    move(10, SHIFT)
    up(10, SHIFT)
    expect(selectedBars()).toEqual([1, 3])
  })

  it('Escape during the drag cancels it and keeps the selection', async () => {
    render(<Harness start={[bar(1)]} />)
    down(3)
    move(10)
    await userEvent.setup().keyboard('{Escape}')
    expect(band()).toBeNull()
    up(10)
    expect(selectedBars()).toEqual([1])
  })

  it('a group made by a band drags together', () => {
    const onEdit = editSpy()
    render(<Harness start={[bar(1)]} onEdit={onEdit} />)
    down(3)
    move(10)
    up(10)
    down(4.6)
    move(4.9)
    up(4.9)
    expect(lastGroupDrag(onEdit)).toMatchObject({ kind: 'drag-group', slots: [bar(2), bar(3)] })
  })
})
