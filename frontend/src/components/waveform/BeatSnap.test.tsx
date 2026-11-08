import { hintOf } from '@/components/ui/hint'
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
// The demo doc has locators at 1, 4.6, 8.2, 11.8 s (bars 1 to 4) in the first 12 s window.
const WINDOW = { startSec: 0, spanSec: 12 }
const xOf = (t: number) => timeToX(t, WINDOW, WIDTH)

const transport: Transport = { ready: true, playing: false, timeSec: 0, durationSec: DURATION, error: false, toggle: vi.fn(), seek: vi.fn() }

// Beats a little off the locators: bar 2 sits at 4.6 s and the tracker heard 4.52 and 4.75 around it.
const BEATS: DetectedBeat[] = [1, 1.9, 2.8, 3.7, 4.52, 4.75, 5.5, 6.4].map((t, index) => ({ t, downbeat: index === 4 ? 0.9 : 0.05 }))

function Harness({
  beats = BEATS,
  selected: given = { bar: 2, passIndex: 0 },
  onEdit = () => null,
}: {
  beats?: DetectedBeat[] | null
  selected?: SlotRef | null
  onEdit?: (edit: DockEdit) => EditRefusal | null
}) {
  const doc = demoDoc()
  const [own, setOwn] = useState<SlotRef | null>(given)
  const [lines, setLines] = useState(false)
  return (
    <>
      <input aria-label="elsewhere" />
      <WaveformDock
        peaks={PEAKS}
        durationSec={DURATION}
        timing={doc.timing}
        beats={beats}
        items={reviewItems(doc, 'clarinet')}
        moved={[]}
        transport={transport}
        selected={own}
        onSelect={setOwn}
        filter="all"
        onFilterChange={() => {}}
        beatLines={lines}
        onBeatLinesChange={setLines}
        onEdit={onEdit}
      />
    </>
  )
}

const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
const down = (t: number) => fireEvent.pointerDown(stage(), { clientX: xOf(t), clientY: 60 })
const move = (t: number, init: object = {}) => fireEvent.pointerMove(stage(), { clientX: xOf(t), clientY: 60, ...init })
const up = (t: number, init: object = {}) => fireEvent.pointerUp(stage(), { clientX: xOf(t), clientY: 60, ...init })
const lastDrag = (onEdit: ReturnType<typeof vi.fn>) => onEdit.mock.calls.at(-1)![0] as Extract<DockEdit, { kind: 'drag' }>

describe('the beat lines with detected beats', () => {
  it('are drawn where the beats were found, the downbeats stronger', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('checkbox', { name: text.beatLines }))

    const lines = [...document.querySelectorAll('[data-slot="dock-beat"]')]
    expect(lines).toHaveLength(8) // all eight beats are inside the 12 s window
    expect(lines.filter((line) => line.getAttribute('data-strong') === 'true')).toHaveLength(1)
    expect(lines[4]).toHaveAttribute('data-strong', 'true')
    expect(Number(lines[4].getAttribute('x1'))).toBeCloseTo(xOf(4.52), 3)
  })

  it('keep the division of the bars when the run has no beats', async () => {
    const user = userEvent.setup()
    render(<Harness beats={null} />)

    await user.click(screen.getByRole('checkbox', { name: text.beatLines }))

    expect(document.querySelectorAll('[data-slot="dock-beat"]')).toHaveLength(9)
  })
})

describe('Snap to a beat', () => {
  it('moves the selected line to the beat before it, as a drag', async () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    await userEvent.setup().click(screen.getByRole('button', { name: text.snapPrevious }))

    expect(onEdit).toHaveBeenCalledWith({ kind: 'drag', slot: { bar: 2, passIndex: 0 }, timeSec: 4.52 })
  })

  it('moves the selected line to the beat after it', async () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    await userEvent.setup().click(screen.getByRole('button', { name: text.snapNext }))

    expect(onEdit).toHaveBeenCalledWith({ kind: 'drag', slot: { bar: 2, passIndex: 0 }, timeSec: 4.75 })
  })

  it('moves the selected line to the closest beat, as a drag', async () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    await userEvent.setup().click(screen.getByRole('button', { name: text.snapClosest }))

    expect(onEdit).toHaveBeenCalledWith({ kind: 'drag', slot: { bar: 2, passIndex: 0 }, timeSec: 4.52 })
  })

  it('has the closest beat on the key /', () => {
    const onEdit = vi.fn<(edit: DockEdit) => EditRefusal | null>(() => null)
    render(<Harness onEdit={onEdit} />)

    fireEvent.keyDown(window, { key: '/' })

    expect(onEdit.mock.calls.map(([edit]) => (edit as { timeSec: number }).timeSec)).toEqual([4.52])
  })

  it('has no closest beat without a selected line, without beats, far from any beat, or on one', () => {
    const closest = () => screen.getByRole('button', { name: text.snapClosest })
    const { unmount } = render(<Harness selected={null} />)
    expect(closest()).toBeDisabled()
    unmount()

    const none = render(<Harness beats={null} />)
    expect(closest()).toBeDisabled()
    expect(hintOf(closest())).toBe(text.snapNoBeats)
    none.unmount()

    // Bar 3 sits at 8.2 s, past the last beat at 6.4 s.
    const far = render(<Harness selected={{ bar: 3, passIndex: 0 }} />)
    expect(closest()).toBeDisabled()
    far.unmount()

    // Bar 1 sits on the first beat at 1 s.
    render(<Harness selected={{ bar: 1, passIndex: 0 }} />)
    expect(closest()).toBeDisabled()
  })

  it('names each Snap button and its key on hover, and says why one is off', () => {
    const { unmount } = render(<Harness />)
    expect(hintOf(screen.getByRole('button', { name: text.snapPrevious }))).toBe(`${text.snapPrevious} (,)`)
    expect(hintOf(screen.getByRole('button', { name: text.snapClosest }))).toBe(`${text.snapClosest} (/)`)
    expect(hintOf(screen.getByRole('button', { name: text.snapNext }))).toBe(`${text.snapNext} (.)`)
    unmount()

    const nothing = render(<Harness selected={null} />)
    expect(hintOf(screen.getByRole('button', { name: text.snapNext }))).toBe(`${text.snapNext} (.). ${text.snapPickLine}`)
    nothing.unmount()

    // Bar 3 at 8.2 s is past the last beat at 6.4 s.
    render(<Harness selected={{ bar: 3, passIndex: 0 }} />)
    expect(hintOf(screen.getByRole('button', { name: text.snapNext }))).toBe(`${text.snapNext} (.). ${text.snapNoBeatWay.next}`)
    expect(hintOf(screen.getByRole('button', { name: text.snapClosest }))).toBe(`${text.snapClosest} (/). ${text.snapNoBeatWay.closest}`)
  })

  it('is on the keys , and .', () => {
    const onEdit = vi.fn<(edit: DockEdit) => EditRefusal | null>(() => null)
    render(<Harness onEdit={onEdit} />)

    fireEvent.keyDown(window, { key: '.' })
    fireEvent.keyDown(window, { key: ',' })

    expect(onEdit.mock.calls.map(([edit]) => (edit as { timeSec: number }).timeSec)).toEqual([4.75, 4.52])
  })

  it('leaves the keys alone while a field is being typed in or a modifier is held', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    fireEvent.keyDown(screen.getByLabelText('elsewhere'), { key: '.' })
    fireEvent.keyDown(window, { key: '.', metaKey: true })

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('is off without a selected line, without beats, and past the first or last beat', () => {
    const { unmount } = render(<Harness selected={null} />)
    expect(screen.getByRole('button', { name: text.snapNext })).toBeDisabled()
    expect(screen.getByRole('button', { name: text.snapPrevious })).toBeDisabled()
    unmount()

    const none = render(<Harness beats={null} />)
    expect(screen.getByRole('button', { name: text.snapNext })).toBeDisabled()
    expect(hintOf(screen.getByRole('button', { name: text.snapNext }))).toBe(text.snapNoBeats)
    none.unmount()

    // Bar 1 sits on the first beat (1 s), which counts as here: there is nothing before it.
    render(<Harness selected={{ bar: 1, passIndex: 0 }} />)
    expect(screen.getByRole('button', { name: text.snapPrevious })).toBeDisabled()
    expect(screen.getByRole('button', { name: text.snapNext })).toBeEnabled()
  })

  it('does nothing on the keys when there is no beat that way', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} selected={{ bar: 1, passIndex: 0 }} />)

    fireEvent.keyDown(window, { key: ',' })

    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('dragging near a beat', () => {
  it('lands on a beat within 30 ms of the pointer', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    down(4.6)
    move(4.77) // 20 ms from the beat at 4.75
    up(4.77)

    expect(lastDrag(onEdit).timeSec).toBe(4.75)
  })

  it('shows the preview line on the beat', () => {
    render(<Harness />)

    down(4.6)
    move(4.77)

    expect(document.querySelector<HTMLElement>('[data-slot="dock-drag-preview"]')!.style.transform).toBe(`translateX(${xOf(4.75)}px)`)
  })

  it('moves freely farther from any beat', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    down(4.6)
    move(5.0)
    up(5.0)

    expect(lastDrag(onEdit).timeSec).toBeCloseTo(5.0, 6)
  })

  it('moves freely while Shift is held', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} />)

    down(4.6)
    move(4.77, { shiftKey: true })
    up(4.77, { shiftKey: true })

    expect(lastDrag(onEdit).timeSec).toBeCloseTo(4.77, 6)
  })

  it('does not snap when the run has no beats', () => {
    const onEdit = vi.fn(() => null)
    render(<Harness onEdit={onEdit} beats={null} />)

    down(4.6)
    move(4.77)
    up(4.77)

    expect(lastDrag(onEdit).timeSec).toBeCloseTo(4.77, 6)
  })

  it('does not take a beat past a neighbouring locator', () => {
    const onEdit = vi.fn(() => null)
    // A beat 5 ms past bar 3 (8.2 s): the line may not go there, so it stays where the pointer is, held back at the neighbour.
    render(<Harness onEdit={onEdit} beats={[{ t: 8.205, downbeat: 0.5 }]} />)

    down(4.6)
    move(8.2)
    up(8.2)

    expect(lastDrag(onEdit).timeSec).toBeLessThan(8.2)
  })
})
