import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { type SlotRef, WaveformDock, type WaveformDockProps } from '@/components/waveform/WaveformDock'
import { timeToX, xToTime } from '@/components/waveform/useDockView'
import { type EditorDoc, type MovedLocator } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { reviewItems } from '@/domain/reviewQueue'
import { type ReviewFlag } from '@/domain/types'
import { type Transport } from '@/lib/useTransport'
import { strings } from '@/strings'

const text = strings.dock
const FLAG: ReviewFlag = { kind: 'crowded', severity: 1, expected: 3.6, found: 1.8, factor: 0.5, explainedBy: null, uncertainLine: null }
const DURATION = 260
// 10 peaks a second; the default window of 12 s is 1000 px wide here (jsdom has no layout, so the dock keeps its default width).
const PEAKS = Array.from({ length: DURATION * 10 }, (_, i) => 0.1 + 0.8 * Math.abs(Math.sin(i / 7)))
const WIDTH = 1000
const WINDOW = { startSec: 0, spanSec: 12 }

/** The demo doc with flags: bar 2 open, bar 3 checked, bar 40 open. Bar 1 is confirmed. */
function flaggedDoc(): EditorDoc {
  const doc = demoDoc()
  const flags = new Map([
    ['2:0', {}],
    ['3:0', { checked: true }],
    ['40:0', {}],
  ])
  return {
    ...doc,
    timing: {
      ...doc.timing,
      locators: doc.timing.locators.map((l) => {
        const extra = flags.get(`${l.bar}:${l.passIndex}`)
        return extra === undefined ? l : { ...l, flags: [FLAG], ...extra }
      }),
    },
  }
}

function fakeTransport(overrides: Partial<Transport> = {}): Transport {
  return { ready: true, playing: false, timeSec: 0, durationSec: DURATION, error: false, toggle: vi.fn(), seek: vi.fn(), ...overrides }
}

interface HarnessProps {
  doc?: EditorDoc
  moved?: readonly MovedLocator[]
  filled?: WaveformDockProps['filled']
  transport?: Transport
  selected?: SlotRef | null
  onSelect?: (slot: SlotRef) => void
  onPointer?: WaveformDockProps['onPointer']
  unavailable?: boolean
}

/** The dock with the filter and beat lines held in state, as the page holds them. `selected` is controlled from outside unless given. */
function Harness({ doc = flaggedDoc(), moved = [], filled, transport = fakeTransport(), selected: given, onSelect, onPointer, unavailable }: HarnessProps) {
  const [filter, setFilter] = useState<'all' | 'review'>('all')
  const [beatLines, setBeatLines] = useState(false)
  const [own, setOwn] = useState<SlotRef | null>(null)
  const selected = given === undefined ? own : given
  const docWithMoved = { ...doc, moved }
  return (
    <WaveformDock
      peaks={PEAKS}
      durationSec={DURATION}
      timing={doc.timing}
      items={reviewItems(docWithMoved, 'clarinet')}
      moved={moved}
      filled={filled}
      transport={transport}
      selected={selected}
      onSelect={(slot) => {
        setOwn(slot)
        onSelect?.(slot)
      }}
      filter={filter}
      onFilterChange={setFilter}
      beatLines={beatLines}
      onBeatLinesChange={setBeatLines}
      onPointer={onPointer}
      unavailable={unavailable}
    />
  )
}

const stage = () => document.querySelector<HTMLElement>('[data-slot="dock-stage"]')!
const locators = () => [...document.querySelectorAll<SVGGElement>('[data-slot="dock-locator"]')]
const locatorOf = (bar: number, pass = 0) => locators().find((el) => el.dataset.bar === `${bar}` && el.dataset.pass === `${pass}`)!
const viewStart = () => Number(stage().dataset.viewStart)
const viewSpan = () => Number(stage().dataset.viewSpan)
const xOf = (t: number) => timeToX(t, WINDOW, WIDTH)

describe('the locator lines', () => {
  it('draws one line per locator in the window, each labelled with its bar', () => {
    render(<Harness />)

    // The window of 12 s holds the locators at 1, 4.6, 8.2 and 11.8 s: bars 1 to 4.
    expect(locators().map((el) => el.dataset.bar)).toEqual(['1', '2', '3', '4'])
    expect(locatorOf(2).querySelector('text')).toHaveTextContent(/^2$/)
  })

  it('labels a bar on its second pass "12 (2)"', () => {
    // Bar 9 is played again at 58.6 s; selecting it from outside brings it into the window.
    render(<Harness selected={{ bar: 9, passIndex: 1 }} />)

    expect(locatorOf(9, 1).querySelector('text')).toHaveTextContent('9 (2)')
  })

  it('colours a line by its state with classes: anchor, problem, selected, plain', () => {
    render(<Harness />)
    fireEvent.pointerDown(stage(), { clientX: xOf(11.8), clientY: 60 })

    expect(locatorOf(1).dataset.state).toBe('anchor')
    expect(locatorOf(1).querySelector('line')).toHaveClass('stroke-anchor')
    expect(locatorOf(2).dataset.state).toBe('problem')
    expect(locatorOf(2).querySelector('line')).toHaveClass('stroke-problem')
    expect(locatorOf(3).dataset.state).toBe('plain')
    expect(locatorOf(4).dataset.state).toBe('selected')
    expect(locatorOf(4).querySelector('line')).toHaveClass('stroke-selected')
  })

  it('tints the span of the selected bar', () => {
    const { rerender } = render(<Harness selected={null} />)
    expect(document.querySelector('[data-slot="dock-selected-span"]')).toBeNull()

    rerender(<Harness selected={{ bar: 2, passIndex: 0 }} />)

    const span = document.querySelector('[data-slot="dock-selected-span"]')!
    expect(Number(span.getAttribute('x'))).toBeCloseTo(xOf(4.6), 6)
    expect(Number(span.getAttribute('width'))).toBeCloseTo(xOf(8.2) - xOf(4.6), 6)
  })

  it('draws a dashed "was" line with its label for a moved locator', () => {
    const doc = flaggedDoc()
    render(<Harness doc={doc} moved={[{ bar: 3, passIndex: 0, fromSec: 7, wasConfirmed: false }]} />)

    const was = document.querySelector('[data-slot="dock-was"]')!
    expect(within(was as HTMLElement).getByText(text.was)).toBeInTheDocument()
    expect(was.querySelector('line')).toHaveAttribute('x1', `${xOf(7)}`)
    expect(was.querySelector('line')).toHaveAttribute('stroke-dasharray')
  })

  it('draws a locator the app filled in as changed, with a tag, until it is confirmed', () => {
    const { rerender } = render(<Harness filled={[{ bar: 3, passIndex: 0 }]} />)

    expect(locatorOf(3).dataset.state).toBe('filled')
    expect(locatorOf(3).querySelector('line')).toHaveClass('stroke-moved')
    expect(document.querySelector('[data-slot="dock-filled-tag"]')).toHaveTextContent(text.filledTag('3'))
    expect(locatorOf(2).dataset.state).toBe('problem')

    const doc = flaggedDoc()
    const confirmed = { ...doc, timing: { ...doc.timing, locators: doc.timing.locators.map((l) => (l.bar === 3 && l.passIndex === 0 ? { ...l, confirmed: true } : l)) } }
    rerender(<Harness doc={confirmed} filled={[{ bar: 3, passIndex: 0 }]} />)

    expect(locatorOf(3).dataset.state).toBe('anchor')
    expect(document.querySelector('[data-slot="dock-filled-tag"]')).toBeNull()
  })

  it('names a run of filled bars with one tag, from its first bar to its last', () => {
    render(<Harness filled={[{ bar: 2, passIndex: 0 }, { bar: 3, passIndex: 0 }, { bar: 4, passIndex: 0 }]} />)

    const tags = document.querySelectorAll('[data-slot="dock-filled-tag"]')
    expect(tags).toHaveLength(1)
    expect(tags[0]).toHaveTextContent(text.filledRunTag('2', '4'))
  })

  it('draws no "was" line when nothing was moved', () => {
    render(<Harness />)

    expect(document.querySelector('[data-slot="dock-was"]')).toBeNull()
  })
})

describe('the All / Review queue filter', () => {
  it('counts every locator and the open items, and checked ones are not open', () => {
    render(<Harness />)

    expect(screen.getByRole('button', { name: text.filterAll(72) })).toHaveAttribute('aria-pressed', 'true')
    // Bars 2 and 40 are open; bar 3 is checked.
    expect(screen.getByRole('button', { name: text.filterReview(2) })).toHaveAttribute('aria-pressed', 'false')
  })

  it('hides the locators that are not open items in the Review queue', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: text.filterReview(2) }))

    expect(locators().map((el) => el.dataset.bar)).toEqual(['2'])
    expect(screen.getByRole('button', { name: text.filterReview(2) })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: text.filterAll(72) }))
    expect(locators()).toHaveLength(4)
  })

  it('keeps a moved locator in the Review queue until it is resolved', async () => {
    const user = userEvent.setup()
    render(<Harness moved={[{ bar: 4, passIndex: 0, fromSec: 11, wasConfirmed: false }]} />)

    await user.click(screen.getByRole('button', { name: text.filterReview(3) }))

    expect(locators().map((el) => el.dataset.bar)).toEqual(['2', '4'])
  })
})

describe('the beat lines', () => {
  it('appear with the toggle: three lines for each 4/4 bar in the window', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(document.querySelectorAll('[data-slot="dock-beat"]')).toHaveLength(0)

    await user.click(screen.getByRole('checkbox', { name: text.beatLines }))

    // Bars 1, 2 and 3 start at 1, 4.6 and 8.2 s and show their beats 2 to 4; bar 4's second beat falls at 12.7 s, past the window.
    expect(document.querySelectorAll('[data-slot="dock-beat"]')).toHaveLength(9)

    await user.click(screen.getByRole('checkbox', { name: text.beatLines }))
    expect(document.querySelectorAll('[data-slot="dock-beat"]')).toHaveLength(0)
  })
})

describe('selecting a locator line', () => {
  it('selects the line under the pointer, within 6 px either side', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)

    fireEvent.pointerDown(stage(), { clientX: xOf(4.6) + 5, clientY: 60 })
    expect(onSelect).toHaveBeenLastCalledWith({ bar: 2, passIndex: 0 })

    fireEvent.pointerDown(stage(), { clientX: xOf(8.2) - 6, clientY: 60 })
    expect(onSelect).toHaveBeenLastCalledWith({ bar: 3, passIndex: 0 })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('does nothing on empty waveform', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)

    fireEvent.pointerDown(stage(), { clientX: xOf(4.6) + 20, clientY: 60 })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('tells onPointer the time, Shift and the locator under it', () => {
    const onPointer = vi.fn()
    render(<Harness onPointer={onPointer} />)

    fireEvent.pointerDown(stage(), { clientX: xOf(4.6), clientY: 60, shiftKey: true })
    fireEvent.pointerMove(stage(), { clientX: xOf(5), clientY: 60 })
    fireEvent.pointerUp(stage(), { clientX: xOf(5), clientY: 60 })

    expect(onPointer).toHaveBeenNthCalledWith(1, { type: 'down', timeSec: expect.closeTo(4.6, 6), shiftKey: true, locator: { bar: 2, passIndex: 0 } })
    expect(onPointer).toHaveBeenNthCalledWith(2, { type: 'move', timeSec: expect.closeTo(5, 6), shiftKey: false, locator: null })
    expect(onPointer).toHaveBeenNthCalledWith(3, { type: 'up', timeSec: expect.closeTo(5, 6), shiftKey: false, locator: null })
  })

  it('moves to the next and previous line with the arrow keys', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} selected={{ bar: 2, passIndex: 0 }} />)

    stage().focus()
    await user.keyboard('{ArrowRight}')
    expect(onSelect).toHaveBeenLastCalledWith({ bar: 3, passIndex: 0 })
    await user.keyboard('{ArrowLeft}')
    expect(onSelect).toHaveBeenLastCalledWith({ bar: 1, passIndex: 0 })
  })
})

describe('seeking at the waveform (the ruler strip is gone)', () => {
  it('has no ruler strip: the bar numbers are the small labels on the bar lines', () => {
    render(<Harness />)

    expect(document.querySelector('[data-slot="dock-ruler"]')).toBeNull()
    expect(screen.queryByText(/^BAR \d/)).toBeNull()
  })

  it('seeks to the time under a plain click on the waveform, also without editing', () => {
    const transport = fakeTransport()
    render(<Harness transport={transport} />)

    fireEvent.pointerDown(stage(), { clientX: 500, clientY: 60 })
    fireEvent.pointerUp(stage(), { clientX: 500, clientY: 60 })

    expect(transport.seek).toHaveBeenCalledWith(6)
  })
})

describe('the zoom', () => {
  it('starts at 12 s, and the buttons zoom within 5 s and the whole recording', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(viewSpan()).toBe(12)

    await user.click(screen.getByRole('button', { name: text.zoomIn }))
    await user.click(screen.getByRole('button', { name: text.zoomIn }))
    await user.click(screen.getByRole('button', { name: text.zoomIn }))
    expect(viewSpan()).toBe(5)

    for (let i = 0; i < 10; i++) await user.click(screen.getByRole('button', { name: text.zoomOut }))
    expect(viewSpan()).toBe(DURATION)
  })

  it('zooms with Shift and + or -, and not with the plain keys', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.keyboard('{Shift>}{+}{/Shift}')
    expect(viewSpan()).toBe(8)
    await user.keyboard('{Shift>}{_}{/Shift}')
    expect(viewSpan()).toBe(12)
    await user.keyboard('-')
    await user.keyboard('+')
    expect(viewSpan()).toBe(12)
  })

  it('does not zoom while typing in a text field', async () => {
    const user = userEvent.setup()
    render(
      <>
        <input aria-label="note" />
        <Harness />
      </>,
    )

    await user.click(screen.getByRole('textbox', { name: 'note' }))
    await user.keyboard('{Shift>}{+}{/Shift}')

    expect(viewSpan()).toBe(12)
  })

  it('pages the window to the playhead while playing', () => {
    const { rerender } = render(<Harness transport={fakeTransport({ playing: true, timeSec: 5 })} />)
    expect(viewStart()).toBe(0)

    rerender(<Harness transport={fakeTransport({ playing: true, timeSec: 20 })} />)

    expect(viewStart()).toBeCloseTo(18.8, 6)
  })

  it('does not move the window for a playhead that is not playing', () => {
    const { rerender } = render(<Harness transport={fakeTransport({ playing: false, timeSec: 5 })} />)

    rerender(<Harness transport={fakeTransport({ playing: false, timeSec: 100 })} />)

    expect(viewStart()).toBe(0)
  })

  it('centres the window on a locator selected from outside, not on one selected here', () => {
    const { rerender } = render(<Harness selected={null} />)

    rerender(<Harness selected={{ bar: 9, passIndex: 1 }} />)

    expect(viewStart()).toBeCloseTo(58.6 - 6, 6)
  })

  it('leaves the window where it is when the line was selected in the dock', () => {
    render(<Harness />)

    fireEvent.pointerDown(stage(), { clientX: xOf(8.2), clientY: 60 })

    expect(viewStart()).toBe(0)
    expect(locatorOf(3).dataset.state).toBe('selected')
  })
})

describe('a press on the line that is already selected', () => {
  it('does not stop the window centring on that line when it is selected from outside later', () => {
    // The Review Queue selected bar 3 (N), then the line was pressed to drag it: the selection did not change.
    const { rerender } = render(<Harness selected={{ bar: 3, passIndex: 0 }} />)
    expect(viewStart()).toBeCloseTo(8.2 - 6, 6)
    fireEvent.pointerDown(stage(), { clientX: timeToX(8.2, { startSec: viewStart(), spanSec: 12 }, WIDTH), clientY: 60 })
    fireEvent.pointerUp(stage(), { clientX: timeToX(8.2, { startSec: viewStart(), spanSec: 12 }, WIDTH), clientY: 60 })

    rerender(<Harness selected={{ bar: 9, passIndex: 1 }} />)
    expect(viewStart()).toBeCloseTo(58.6 - 6, 6)
    rerender(<Harness selected={{ bar: 3, passIndex: 0 }} />)

    expect(viewStart()).toBeCloseTo(8.2 - 6, 6)
  })
})

describe('the playhead', () => {
  it('stands at the time of the transport, inside the window', () => {
    render(<Harness transport={fakeTransport({ timeSec: 6 })} />)

    const playhead = document.querySelector<HTMLElement>('[data-slot="dock-playhead"]')!
    expect(playhead.style.transform).toBe(`translateX(${xOf(6)}px)`)
  })

  it('is hidden outside the window', () => {
    render(<Harness transport={fakeTransport({ timeSec: 100 })} />)

    expect(document.querySelector<HTMLElement>('[data-slot="dock-playhead"]')!.style.display).toBe('none')
  })
})

describe('the transport row', () => {
  it('shows the time as m:ss.s / m:ss.s', () => {
    render(<Harness transport={fakeTransport({ timeSec: 102.34, durationSec: 271 })} />)

    expect(screen.getByLabelText(text.timeLabel)).toHaveTextContent('1:42.3 / 4:31.0')
  })

  it('has the Practice play ring, 88 px, that says Play, then Pause, and toggles', async () => {
    const user = userEvent.setup()
    const transport = fakeTransport()
    const { rerender } = render(<Harness transport={transport} />)

    const play = screen.getByRole('button', { name: text.play })
    expect(document.querySelector('[data-slot="play-ring"]')).toHaveClass('size-[88px]')
    await user.click(play)
    expect(transport.toggle).toHaveBeenCalledTimes(1)

    rerender(<Harness transport={fakeTransport({ playing: true })} />)
    expect(screen.getByRole('button', { name: text.pause })).toBeInTheDocument()
  })

  it('disables Play and says why when there is no recording to play', () => {
    render(<Harness transport={fakeTransport({ ready: false, durationSec: null })} unavailable />)

    expect(screen.getByRole('button', { name: text.play })).toBeDisabled()
    expect(screen.getByText(text.noRecording)).toBeInTheDocument()
  })

  it('shows no hint, and the bar chip: the selected bar when paused, the bar under the playhead while playing', () => {
    const { rerender } = render(<Harness selected={{ bar: 4, passIndex: 0 }} transport={fakeTransport({ timeSec: 5 })} />)

    expect(screen.queryByText(/Drag/)).toBeNull()
    expect(screen.getByLabelText(text.barChipLabel)).toHaveTextContent('Bar 4')

    // 5 s is inside bar 2 (4.6 to 8.2 s).
    rerender(<Harness selected={{ bar: 4, passIndex: 0 }} transport={fakeTransport({ timeSec: 5, playing: true })} />)
    expect(screen.getByLabelText(text.barChipLabel)).toHaveTextContent('Bar 2')
  })

  it('says which time through the bar it is from the second on, for the selected line', () => {
    const { rerender } = render(<Harness selected={{ bar: 4, passIndex: 1 }} transport={fakeTransport({ timeSec: 5 })} />)
    expect(screen.getByLabelText(text.barChipLabel)).toHaveTextContent('Bar 4 (2)')

    rerender(<Harness selected={{ bar: 4, passIndex: 0 }} transport={fakeTransport({ timeSec: 5 })} />)
    expect(screen.getByLabelText(text.barChipLabel)).toHaveTextContent(/^Bar 4$/)
  })

  it('shows the bar under the playhead when nothing is selected, and no chip outside the bars', () => {
    const { rerender } = render(<Harness transport={fakeTransport({ timeSec: 5 })} />)
    expect(screen.getByLabelText(text.barChipLabel)).toHaveTextContent('Bar 2')

    rerender(<Harness transport={fakeTransport({ timeSec: 0.2 })} />)
    expect(screen.queryByLabelText(text.barChipLabel)).toBeNull()
  })
})

describe('Space', () => {
  it('toggles the transport', async () => {
    const user = userEvent.setup()
    const transport = fakeTransport()
    render(<Harness transport={transport} />)

    await user.keyboard(' ')

    expect(transport.toggle).toHaveBeenCalledTimes(1)
  })

  it('is left alone in a text field', async () => {
    const user = userEvent.setup()
    const transport = fakeTransport()
    render(
      <>
        <input aria-label="note" />
        <Harness transport={transport} />
      </>,
    )

    await user.click(screen.getByRole('textbox', { name: 'note' }))
    await user.keyboard(' ')

    expect(transport.toggle).not.toHaveBeenCalled()
  })

  it('leaves a focused button to press itself, so a button is not pressed twice', async () => {
    const user = userEvent.setup()
    const transport = fakeTransport()
    render(<Harness transport={transport} />)

    screen.getByRole('button', { name: text.zoomIn }).focus()
    await user.keyboard(' ')

    expect(transport.toggle).not.toHaveBeenCalled()
    expect(viewSpan()).toBe(8)
  })
})

describe('the waveform', () => {
  it('draws the peaks of the window as bars coloured by amplitude', () => {
    render(<Harness />)

    const bars = [...document.querySelectorAll('[data-slot="dock-wave-bar"]')]
    expect(bars.length).toBeGreaterThan(100)
    expect(bars.length).toBeLessThanOrEqual(WIDTH / 4)
    const classes = new Set(bars.map((bar) => ['fill-wave-low', 'fill-wave-mid', 'fill-wave-high'].find((name) => bar.classList.contains(name))))
    expect(classes.has(undefined)).toBe(false)
    expect(classes.size).toBeGreaterThan(1)
  })

  it('has no shortcut strip under the waveform any more (the keys move to Settings)', () => {
    render(<Harness moved={[{ bar: 3, passIndex: 0, fromSec: 7, wasConfirmed: false }]} />)

    expect(document.querySelector('[data-slot="dock-shortcuts"]')).toBeNull()
  })
})

describe('the wheel on the waveform', () => {
  // 1000 px is 12 s here, so 100 px of deltaX is 1.2 s.
  const wheel = (init: WheelEventInit) => fireEvent.wheel(stage(), init)

  it('pans by deltaX in seconds of the window, content following the fingers', () => {
    render(<Harness />)

    wheel({ deltaX: 100 })
    expect(viewStart()).toBeCloseTo(1.2, 9)
    wheel({ deltaX: -50 })
    expect(viewStart()).toBeCloseTo(0.6, 9)
    expect(viewSpan()).toBe(12)
  })

  it('counts a line of deltaX as 16 px', () => {
    render(<Harness />)

    wheel({ deltaX: 5, deltaMode: 1 })

    expect(viewStart()).toBeCloseTo((5 * 16 * 12) / WIDTH, 9)
  })

  it('stops at both ends of the recording', () => {
    render(<Harness />)

    wheel({ deltaX: -500 })
    expect(viewStart()).toBe(0)
    wheel({ deltaX: 1_000_000 })
    expect(viewStart()).toBe(DURATION - 12)
  })

  it('zooms in one step per 40 px of deltaY down, and not before', () => {
    render(<Harness />)

    wheel({ deltaY: 15 })
    wheel({ deltaY: 15 })
    expect(viewSpan()).toBe(12)
    wheel({ deltaY: 15 })
    expect(viewSpan()).toBe(8)
    wheel({ deltaY: 40 })
    expect(viewSpan()).toBe(5)
  })

  it('zooms out on deltaY up, and starts counting again when the direction changes', () => {
    render(<Harness />)

    wheel({ deltaY: 30 })
    wheel({ deltaY: -30 })
    expect(viewSpan()).toBe(12)
    wheel({ deltaY: -10 })
    expect(viewSpan()).toBe(20)
  })

  it('keeps the time under the pointer where it was', () => {
    render(<Harness />)
    const x = 250
    const t = xToTime(x, WINDOW, WIDTH)

    wheel({ deltaY: 40, clientX: x })

    expect(viewSpan()).toBe(8)
    expect(viewStart() + (x / WIDTH) * viewSpan()).toBeCloseTo(t, 9)
  })

  it('does only the larger action of a diagonal swipe', () => {
    render(<Harness />)

    wheel({ deltaX: 100, deltaY: 50 })
    expect(viewSpan()).toBe(12)
    expect(viewStart()).toBeCloseTo(1.2, 9)
    wheel({ deltaX: 10, deltaY: 50 })
    expect(viewSpan()).toBe(8)
  })

  it('pans on Shift with a vertical wheel', () => {
    render(<Harness />)

    wheel({ deltaY: 100, shiftKey: true })

    expect(viewStart()).toBeCloseTo(1.2, 9)
    expect(viewSpan()).toBe(12)
  })

  it('zooms a trackpad pinch the way the fingers move: spread (deltaY below 0) is in, pinch together is out', () => {
    render(<Harness />)

    wheel({ deltaY: -12, ctrlKey: true })
    expect(viewSpan()).toBe(8)
    wheel({ deltaY: 12, ctrlKey: true })
    expect(viewSpan()).toBe(12)
  })

  it('holds the page still on the stage: the listener is not passive and the event is cancelled', () => {
    const spy = vi.spyOn(EventTarget.prototype, 'addEventListener')
    render(<Harness />)
    const calls = spy.mock.calls.map((call, index) => ({ call, target: spy.mock.contexts[index] })).filter(({ call, target }) => call[0] === 'wheel' && target === stage())
    spy.mockRestore()

    expect(calls).toHaveLength(1)
    expect(calls[0].call[2]).toMatchObject({ passive: false })
    expect(wheel({ deltaY: 40 })).toBe(false)
    expect(wheel({ deltaX: 40 })).toBe(false)
    expect(wheel({ deltaX: 0, deltaY: 0 })).toBe(true)
  })

  it('leaves the wheel alone outside the stage', () => {
    render(<Harness />)

    expect(fireEvent.wheel(screen.getByLabelText(text.timeLabel), { deltaX: 100 })).toBe(true)
    expect(viewStart()).toBe(0)
  })

  it('keeps the Shift + / - keys and the zoom buttons', async () => {
    render(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: text.zoomIn }))
    expect(viewSpan()).toBe(8)
    await userEvent.keyboard('{Shift>}={/Shift}')
    expect(viewSpan()).toBe(5)
  })

  describe('while it plays', () => {
    const playing = (timeSec: number) => fakeTransport({ playing: true, timeSec })

    it('stops following the playhead after a manual pan, and follows again on the next Play', () => {
      const { rerender } = render(<Harness transport={playing(5)} />)

      wheel({ deltaX: 100 })
      rerender(<Harness transport={playing(100)} />)
      expect(viewStart()).toBeCloseTo(1.2, 9)

      rerender(<Harness transport={fakeTransport({ playing: false, timeSec: 100 })} />)
      rerender(<Harness transport={playing(100)} />)
      expect(viewStart()).toBeCloseTo(100 - 1.2, 9)
    })

    it('stops following after a manual zoom as well', () => {
      const { rerender } = render(<Harness transport={playing(5)} />)

      wheel({ deltaY: 40 })
      rerender(<Harness transport={playing(100)} />)

      expect(viewStart()).toBeLessThan(10)
    })

    it('follows again after the selection changes', () => {
      const { rerender } = render(<Harness transport={playing(5)} selected={{ bar: 1, passIndex: 0 }} />)

      wheel({ deltaX: 100 })
      rerender(<Harness transport={playing(5)} selected={{ bar: 2, passIndex: 0 }} />)
      rerender(<Harness transport={playing(200)} selected={{ bar: 2, passIndex: 0 }} />)

      expect(viewStart()).toBeCloseTo(200 - 1.2, 9)
    })
  })
})

describe('the stage takes the height it is given', () => {
  // jsdom has no layout: a stand-in ResizeObserver reports the sizes the tests set on the elements.
  let observers: { callback: () => void }[] = []
  beforeEach(() => {
    observers = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push({ callback })
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  const measure = (height: number) => {
    Object.defineProperty(stage().parentElement!, 'clientWidth', { value: WIDTH, configurable: true })
    Object.defineProperty(stage(), 'clientHeight', { value: height, configurable: true })
    act(() => observers.forEach((observer) => observer.callback()))
  }
  const num = (element: Element | null | undefined, name: string) => Number(element!.getAttribute(name))
  const bottomOf = (bar: Element) => num(bar, 'y') + num(bar, 'height')

  it('keeps 150 px where nothing can be measured', () => {
    render(<Harness />)

    expect(stage().querySelector('svg')).toHaveAttribute('height', '150')
    expect(stage().querySelector('line')).toHaveAttribute('y1', '136')
  })

  it('draws the baseline, the bars, the lines and their handles to the measured height', () => {
    render(<Harness moved={[{ bar: 3, passIndex: 0, fromSec: 7, wasConfirmed: false }]} selected={{ bar: 2, passIndex: 0 }} />)
    fireEvent.click(screen.getByRole('checkbox', { name: text.beatLines }))
    const before = Math.max(...[...document.querySelectorAll('[data-slot="dock-wave-bar"]')].map((bar) => num(bar, 'height')))

    measure(300)

    const svg = stage().querySelector('svg')!
    expect(svg).toHaveAttribute('height', '300')
    expect(svg).toHaveAttribute('viewBox', `0 0 ${WIDTH} 300`)
    // The baseline sits 14 px above the bottom; everything hangs from it.
    expect(svg.querySelector('line')).toHaveAttribute('y1', '286')
    const bars = [...document.querySelectorAll('[data-slot="dock-wave-bar"]')]
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) expect(bottomOf(bar)).toBe(286)
    expect(Math.max(...bars.map((bar) => num(bar, 'height')))).toBeGreaterThan(before * 2)
    for (const locator of locators()) {
      expect(locator.querySelector('line')).toHaveAttribute('y2', '286')
      expect(locator.querySelector('circle')).toHaveAttribute('cy', '286')
    }
    expect(document.querySelector('[data-slot="dock-selected-span"]')).toHaveAttribute('height', `${286 - 18}`)
    expect(document.querySelector('[data-slot="dock-was"] line')).toHaveAttribute('y2', '286')
    const beats = [...document.querySelectorAll('[data-slot="dock-beat"]')]
    expect(beats.length).toBeGreaterThan(0)
    for (const beat of beats) expect(beat).toHaveAttribute('y2', '286')
  })

  it('follows the dock back down to a short stage and never draws bars below the baseline or above the labels', () => {
    render(<Harness />)

    measure(60)

    expect(stage().querySelector('svg')).toHaveAttribute('height', '60')
    for (const bar of document.querySelectorAll('[data-slot="dock-wave-bar"]')) {
      expect(bottomOf(bar)).toBe(46)
      expect(num(bar, 'y')).toBeGreaterThanOrEqual(18)
    }
  })

  it('leaves the pointer hit-testing on x, whatever the height', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    measure(300)

    fireEvent.pointerDown(stage(), { clientX: xOf(4.6) + 3, clientY: 200 })

    expect(onSelect).toHaveBeenCalledWith({ bar: 2, passIndex: 0 })
  })
})
