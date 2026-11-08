import { renderHook } from '@testing-library/react'
import { type ScorePointerEvent } from '@/components/score/ScoreView'
import { type BarBox } from '@/domain/types'
import { type EditMode } from '@/lib/useEditorDoc'
import { DOUBLE_CLICK_MS, useBarClicks } from './useBarClicks'

// Line 1: bar 1 starts after a clef (x 100), bar 3 after a time signature (gap of 40); line 2 starts at x 60.
const boxes: BarBox[] = [
  { bar: 1, pageIndex: 0, x: 100, y: 100, w: 200, h: 100 },
  { bar: 2, pageIndex: 0, x: 300, y: 100, w: 200, h: 100 },
  { bar: 3, pageIndex: 0, x: 540, y: 100, w: 160, h: 100 },
  { bar: 4, pageIndex: 0, x: 60, y: 300, w: 240, h: 100 },
]

function click(mode: EditMode, x: number, y: number, up: { x: number; y: number } = { x, y }): number[] {
  const picked: number[] = []
  const { result } = renderHook(() => useBarClicks(boxes, mode, (bar) => picked.push(bar)))
  const event = (type: ScorePointerEvent['type'], at: { x: number; y: number }): ScorePointerEvent => ({ type, pageIndex: 0, ...at, shiftKey: false })
  result.current.onPointer(event('down', { x, y }))
  result.current.onPointer(event('up', up))
  return picked
}

describe('useBarClicks in Move mode', () => {
  it('picks the bar under the click', () => {
    expect(click('move', 400, 150)).toEqual([2])
  })

  it('picks the first bar of a line for a click on its clef area', () => {
    expect(click('move', 30, 150)).toEqual([1])
    expect(click('move', 20, 350)).toEqual([4])
  })

  it('picks the bar that follows a gap for a click on the signature before it', () => {
    expect(click('move', 520, 150)).toEqual([3])
  })

  it('picks nothing past the end of a line or between lines', () => {
    expect(click('move', 760, 150)).toEqual([])
    expect(click('move', 400, 250)).toEqual([])
  })

  it('treats a press on a bar line or on the start of a line as a drag, not a click', () => {
    expect(click('move', 300, 150)).toEqual([])
    expect(click('move', 104, 150)).toEqual([])
  })

  it('treats a press on the end of a line as a drag too, on either side of it', () => {
    expect(click('move', 696, 150)).toEqual([])
    expect(click('move', 706, 150)).toEqual([])
    expect(click('move', 680, 150)).toEqual([3])
  })

  it('is not a click when the pointer travelled far', () => {
    expect(click('move', 400, 150, { x: 460, y: 150 })).toEqual([])
  })

  it('does nothing in the other modes', () => {
    expect(click('add', 400, 150)).toEqual([])
    expect(click('delete', 400, 150)).toEqual([])
  })
})

// A second click on the same bar within DOUBLE_CLICK_MS, with no drag, is a double click: the page steps to the next pass.
// The clicks are counted here by time and bar, from pointer events, so a touch screen takes the same path.
describe('a double click on a bar in Move mode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(mode: EditMode = 'move') {
    const picked: [number, boolean][] = []
    const { result, rerender } = renderHook(({ mode: current }) => useBarClicks(boxes, current, (bar, again) => picked.push([bar, again])), { initialProps: { mode } })
    const event = (type: ScorePointerEvent['type'], x: number, y: number): ScorePointerEvent => ({ type, pageIndex: 0, x, y, shiftKey: false })
    const tap = (x: number, y: number, afterMs = 0, up: { x: number; y: number } = { x, y }) => {
      vi.advanceTimersByTime(afterMs)
      result.current.onPointer(event('down', x, y))
      result.current.onPointer(event('up', up.x, up.y))
    }
    return { picked, tap, rerender }
  }

  it('is flagged on the second click of the same bar within the time', () => {
    const { picked, tap } = setup()
    tap(400, 150)
    tap(405, 152, DOUBLE_CLICK_MS - 1)
    expect(picked).toEqual([[2, false], [2, true]])
  })

  it('is not one when the second click comes too late', () => {
    const { picked, tap } = setup()
    tap(400, 150)
    tap(400, 150, DOUBLE_CLICK_MS + 1)
    expect(picked).toEqual([[2, false], [2, false]])
  })

  it('is not one on another bar', () => {
    const { picked, tap } = setup()
    tap(400, 150)
    tap(620, 150, 100)
    expect(picked).toEqual([[2, false], [3, false]])
  })

  it('is not one when the first press was a drag', () => {
    const { picked, tap } = setup()
    tap(400, 150, 0, { x: 460, y: 150 })
    tap(400, 150, 100)
    expect(picked).toEqual([[2, false]])
  })

  it('is not one when the second press moved: a drag does not step', () => {
    const { picked, tap } = setup()
    tap(400, 150)
    tap(400, 150, 100, { x: 460, y: 150 })
    expect(picked).toEqual([[2, false]])
  })

  it('counts a double click once: the next click starts over', () => {
    const { picked, tap } = setup()
    tap(400, 150)
    tap(400, 150, 100)
    tap(400, 150, 100)
    expect(picked).toEqual([[2, false], [2, true], [2, false]])
  })

  it('does nothing in the other modes, and a click in Move mode after a mode change starts over', () => {
    const { picked, tap, rerender } = setup('add')
    tap(400, 150)
    rerender({ mode: 'move' })
    tap(400, 150, 100)
    expect(picked).toEqual([[2, false]])
  })
})
