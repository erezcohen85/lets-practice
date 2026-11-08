import { act, renderHook } from '@testing-library/react'
import { spanSteps, timeToX, useDockView, xToTime } from '@/components/waveform/useDockView'

describe('timeToX and xToTime', () => {
  const view = { startSec: 30, spanSec: 12 }

  it('put the window start on 0 and its end on the width', () => {
    expect(timeToX(30, view, 960)).toBe(0)
    expect(timeToX(42, view, 960)).toBe(960)
    expect(timeToX(36, view, 960)).toBe(480)
  })

  it('go back and forth', () => {
    for (const t of [0, 31.25, 36, 41.9, 120]) expect(xToTime(timeToX(t, view, 800), view, 800)).toBeCloseTo(t, 9)
    for (const x of [0, 13, 400, 799]) expect(timeToX(xToTime(x, view, 800), view, 800)).toBeCloseTo(x, 9)
  })

  it('give times before the window a negative position and do not divide by a width of 0', () => {
    expect(timeToX(24, view, 960)).toBe(-480)
    expect(xToTime(10, view, 0)).toBe(30)
  })
})

describe('spanSteps', () => {
  it('runs from 5 seconds to the whole recording', () => {
    expect(spanSteps(271)).toEqual([5, 8, 12, 20, 30, 60, 120, 271])
  })

  it('leaves out the steps a short recording cannot show', () => {
    expect(spanSteps(10)).toEqual([5, 8, 10])
    expect(spanSteps(3)).toEqual([3])
  })
})

describe('useDockView', () => {
  it('starts at the beginning with a window of 12 seconds', () => {
    const { result } = renderHook(() => useDockView(271))

    expect(result.current.view).toEqual({ startSec: 0, spanSec: 12 })
  })

  it('shows a short recording whole', () => {
    const { result } = renderHook(() => useDockView(9))

    expect(result.current.view).toEqual({ startSec: 0, spanSec: 9 })
  })

  it('zooms in to 5 seconds and no further', () => {
    const { result } = renderHook(() => useDockView(271))

    act(() => result.current.zoomIn())
    expect(result.current.view.spanSec).toBe(8)
    act(() => result.current.zoomIn())
    expect(result.current.view.spanSec).toBe(5)
    act(() => result.current.zoomIn())
    expect(result.current.view.spanSec).toBe(5)
  })

  it('zooms out to the whole recording and no further', () => {
    const { result } = renderHook(() => useDockView(271))

    for (let i = 0; i < 10; i++) act(() => result.current.zoomOut())

    expect(result.current.view).toEqual({ startSec: 0, spanSec: 271 })
  })

  it('keeps the middle of the window while zooming', () => {
    const { result } = renderHook(() => useDockView(271))
    act(() => result.current.centreOn(100))

    act(() => result.current.zoomOut())

    const { startSec, spanSec } = result.current.view
    expect(startSec + spanSec / 2).toBeCloseTo(100, 9)
    expect(spanSec).toBe(20)
  })

  it('zooms around a point of the window and keeps that time where it was', () => {
    const { result } = renderHook(() => useDockView(271))
    act(() => result.current.centreOn(100))
    const { startSec, spanSec } = result.current.view
    const t = startSec + 0.25 * spanSec

    act(() => result.current.zoomAt(1, 0.25))

    expect(result.current.view.spanSec).toBe(8)
    expect(result.current.view.startSec + 0.25 * 8).toBeCloseTo(t, 9)
    act(() => result.current.zoomAt(-1, 0.25))
    expect(result.current.view.spanSec).toBe(12)
    expect(result.current.view.startSec + 0.25 * 12).toBeCloseTo(t, 9)
  })

  it('centres on a time, and keeps the window inside the recording', () => {
    const { result } = renderHook(() => useDockView(271))

    act(() => result.current.centreOn(100))
    expect(result.current.view).toEqual({ startSec: 94, spanSec: 12 })
    act(() => result.current.centreOn(2))
    expect(result.current.view.startSec).toBe(0)
    act(() => result.current.centreOn(270))
    expect(result.current.view.startSec).toBe(271 - 12)
  })

  it('scrolls by seconds inside the recording', () => {
    const { result } = renderHook(() => useDockView(271))

    act(() => result.current.scrollBy(5))
    expect(result.current.view.startSec).toBe(5)
    act(() => result.current.scrollBy(-50))
    expect(result.current.view.startSec).toBe(0)
  })

  it('pages to the playhead when it leaves the window, and stays put while it is inside', () => {
    const { result } = renderHook(() => useDockView(271))

    act(() => result.current.follow(11))
    expect(result.current.view.startSec).toBe(0)
    act(() => result.current.follow(12.5))
    expect(result.current.view.startSec).toBeCloseTo(12.5 - 1.2, 9)
    act(() => result.current.follow(0))
    expect(result.current.view.startSec).toBe(0)
  })
})
