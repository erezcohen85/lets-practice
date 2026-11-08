import { act, renderHook } from '@testing-library/react'
import { CLICK_SLOP_PX, type Gesture, useLocatorGestures } from '@/components/waveform/useLocatorGestures'

// The waveform's click: with Add locator off it moves the play line (Decisions 2026-11-06, replacing spec 5.4's
// click-adds); with it on it adds, following the Renumber switch and Shift. A press on a line is never a seek or an add.

const view = { startSec: 0, spanSec: 100 }
const width = 1000 // 10 px a second
const locators = [
  { bar: 1, passIndex: 0, timeSec: 10 },
  { bar: 2, passIndex: 0, timeSec: 20 },
]
const line = { bar: 1, passIndex: 0 }

function setup({
  enabled = true,
  addLocator = false,
  selection = [],
  visible,
  canSelect,
}: { enabled?: boolean; addLocator?: boolean; selection?: { bar: number; passIndex: number }[]; visible?: typeof locators; canSelect?: boolean } = {}) {
  const gestures: Gesture[] = []
  const hook = renderHook(() =>
    useLocatorGestures({
      enabled,
      addLocator,
      locators,
      selection,
      visible,
      canSelect,
      beats: null,
      durationSec: 100,
      view,
      width,
      onGesture: (gesture) => gestures.push(gesture),
    }),
  )
  const press = (x: number, slot: typeof line | null, release: { x?: number; shiftKey?: boolean } = {}) =>
    act(() => {
      hook.result.current.onDown({ x, shiftKey: release.shiftKey ?? false }, slot)
      if (release.x !== undefined && release.x !== x) hook.result.current.onMove({ x: release.x, shiftKey: release.shiftKey ?? false })
      hook.result.current.onUp({ x: release.x ?? x, shiftKey: release.shiftKey ?? false })
    })
  return { gestures, press, hook }
}

describe('a click on empty waveform with Add locator off', () => {
  it('moves the play line to that time', () => {
    const { gestures, press } = setup()
    press(600, null)
    expect(gestures).toEqual([{ kind: 'seek', timeSec: 60 }])
  })

  it('does the same with Shift held', () => {
    const { gestures, press } = setup()
    press(600, null, { shiftKey: true })
    expect(gestures).toEqual([{ kind: 'seek', timeSec: 60 }])
  })

  it('does not add a locator', () => {
    const { gestures, press } = setup()
    press(150, null)
    expect(gestures.some((gesture) => gesture.kind === 'add')).toBe(false)
  })

  it('still seeks when the dock cannot edit', () => {
    const { gestures, press } = setup({ enabled: false })
    press(250, null)
    expect(gestures).toEqual([{ kind: 'seek', timeSec: 25 }])
  })

  it('is not a click when the press moved further than the slop', () => {
    const { gestures, press } = setup()
    press(600, null, { x: 600 + CLICK_SLOP_PX + 1 })
    // It is a band now (task 16), which selects; what it must not do is seek or add.
    expect(gestures.filter((gesture) => gesture.kind === 'seek' || gesture.kind === 'add')).toEqual([])
  })
})

describe('a click on empty waveform with Add locator on', () => {
  it('adds a locator at that time, without Shift', () => {
    const { gestures, press } = setup({ addLocator: true })
    press(600, null)
    expect(gestures).toEqual([{ kind: 'add', timeSec: 60, shift: false }])
  })

  it('passes Shift on, which the edit turns into the other renumber mode', () => {
    const { gestures, press } = setup({ addLocator: true })
    press(600, null, { shiftKey: true })
    expect(gestures).toEqual([{ kind: 'add', timeSec: 60, shift: true }])
  })

  it('does not add when the dock cannot edit', () => {
    const { gestures, press } = setup({ addLocator: true, enabled: false })
    press(600, null)
    expect(gestures).toEqual([{ kind: 'seek', timeSec: 60 }])
  })

  it('does nothing when the press moved further than the slop', () => {
    const { gestures, press } = setup({ addLocator: true })
    press(600, null, { x: 600 + CLICK_SLOP_PX + 1 })
    // It is a band now (task 16), which selects; what it must not do is seek or add.
    expect(gestures.filter((gesture) => gesture.kind === 'seek' || gesture.kind === 'add')).toEqual([])
  })
})

describe.each([false, true])('a press on a line (Add locator %s)', (addLocator) => {
  it('released in place neither seeks nor adds', () => {
    const { gestures, press } = setup({ addLocator })
    press(100, line)
    expect(gestures).toEqual([])
  })

  it('dragged moves the line', () => {
    const { gestures, press } = setup({ addLocator })
    press(100, line, { x: 150 })
    expect(gestures).toEqual([{ kind: 'drag', slot: line, timeSec: 15 }])
  })

  it('does nothing when the dock cannot edit', () => {
    const { gestures, press } = setup({ addLocator, enabled: false })
    press(100, line, { x: 150 })
    press(100, line)
    expect(gestures).toEqual([])
  })
})


// Task 16: a press on empty waveform that moves past the slop draws a band; the lines inside become the selection.
describe('a selection band on empty waveform', () => {
  const lines = [
    { bar: 1, passIndex: 0, timeSec: 10 },
    { bar: 2, passIndex: 0, timeSec: 20 },
    { bar: 3, passIndex: 0, timeSec: 30 },
    { bar: 4, passIndex: 0, timeSec: 40 },
  ]
  const slot = (bar: number) => ({ bar, passIndex: 0 })

  it('selects the lines between the press and the release, either way round, and does not seek or add', () => {
    for (const addLocator of [false, true]) {
      const { gestures, press } = setup({ addLocator, visible: lines })
      press(150, null, { x: 350 })
      press(350, null, { x: 150 })
      expect(gestures).toEqual([
        { kind: 'select', slots: [slot(2), slot(3)] },
        { kind: 'select', slots: [slot(2), slot(3)] },
      ])
    }
  })

  it('shows the lines inside live and the box while the pointer moves', () => {
    const { hook } = setup({ visible: lines })
    act(() => {
      hook.result.current.onDown({ x: 150, shiftKey: false }, null)
      hook.result.current.onMove({ x: 250, shiftKey: false })
    })
    expect(hook.result.current.band).toEqual({ x0: 150, x1: 250, slots: [slot(2)] })
    act(() => hook.result.current.onMove({ x: 350, shiftKey: false }))
    expect(hook.result.current.band?.slots).toEqual([slot(2), slot(3)])
    act(() => hook.result.current.onUp({ x: 350, shiftKey: false }))
    expect(hook.result.current.band).toBeNull()
  })

  it('does not start within the slop: that is still a click', () => {
    const { gestures, hook } = setup({ visible: lines })
    act(() => {
      hook.result.current.onDown({ x: 150, shiftKey: false }, null)
      hook.result.current.onMove({ x: 150 + CLICK_SLOP_PX, shiftKey: false })
    })
    expect(hook.result.current.band).toBeNull()
    act(() => hook.result.current.onUp({ x: 150 + CLICK_SLOP_PX, shiftKey: false }))
    expect(gestures).toHaveLength(1)
    expect(gestures[0]).toMatchObject({ kind: 'seek' })
    expect((gestures[0] as { timeSec: number }).timeSec).toBeCloseTo(15.3)
  })

  it('a band with nothing inside clears the selection', () => {
    const { gestures, press } = setup({ visible: lines, selection: [slot(1), slot(2)] })
    press(210, null, { x: 290 })
    expect(gestures).toEqual([{ kind: 'select', slots: [] }])
  })

  it('Shift at the release adds the lines inside to the current selection', () => {
    const { gestures, press } = setup({ visible: lines, selection: [slot(1), slot(3)] })
    press(150, null, { x: 350, shiftKey: true })
    expect(gestures).toEqual([{ kind: 'select', slots: [slot(1), slot(3), slot(2)] }])
  })

  it('Shift with nothing inside keeps the selection', () => {
    const { gestures, press } = setup({ visible: lines, selection: [slot(1)] })
    press(210, null, { x: 290, shiftKey: true })
    expect(gestures).toEqual([{ kind: 'select', slots: [slot(1)] }])
  })

  it('selects only the visible lines (the filter)', () => {
    const { gestures, press } = setup({ visible: [lines[0], lines[2]] })
    press(50, null, { x: 450 })
    expect(gestures).toEqual([{ kind: 'select', slots: [slot(1), slot(3)] }])
  })

  it('Escape during the drag cancels it and changes nothing', () => {
    const { gestures, hook } = setup({ visible: lines, selection: [slot(1)] })
    act(() => {
      hook.result.current.onDown({ x: 150, shiftKey: false }, null)
      hook.result.current.onMove({ x: 350, shiftKey: false })
    })
    expect(hook.result.current.band).not.toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(hook.result.current.band).toBeNull()
    act(() => hook.result.current.onUp({ x: 350, shiftKey: false }))
    expect(gestures).toEqual([])
  })

  it('needs editing rights', () => {
    const { gestures, hook, press } = setup({ enabled: false, visible: lines })
    press(150, null, { x: 350 })
    expect(gestures).toEqual([])
    expect(hook.result.current.band).toBeNull()
  })

  it('does nothing without a way to choose several lines', () => {
    const { gestures, press } = setup({ visible: lines, canSelect: false })
    press(150, null, { x: 350 })
    expect(gestures).toEqual([])
  })

  it('clamps to the waveform edges', () => {
    const { gestures, press } = setup({ visible: lines })
    press(350, null, { x: 5000 })
    expect(gestures).toEqual([{ kind: 'select', slots: [slot(4)] }])
  })

  it('a press on a line is still a line drag, not a band', () => {
    const { gestures, hook } = setup({ visible: lines })
    act(() => {
      hook.result.current.onDown({ x: 100, shiftKey: false }, line)
      hook.result.current.onMove({ x: 150, shiftKey: false })
    })
    expect(hook.result.current.band).toBeNull()
    act(() => hook.result.current.onUp({ x: 150, shiftKey: false }))
    expect(gestures).toEqual([{ kind: 'drag', slot: line, timeSec: 15 }])
  })
})
