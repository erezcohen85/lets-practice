import { act, render, renderHook } from '@testing-library/react'
import { createFollowClock } from '@/components/practice/followClock'
import { LINE_AT } from '@/components/practice/useFollowScroll'
import { type SlotTiming } from '@/domain/tempo'
import { type PageLayer } from '@/domain/types'
import { useEditorFollowScroll } from './useEditorFollowScroll'

// Four bars of two seconds, two to a line; the second line is on page 1.
const meter = { numerator: 4, denominator: 4 }
const timeline: SlotTiming[] = [1, 2, 3, 4].map((bar, i) => ({
  slot: { position: i, bar, passIndex: 0 },
  startSec: i * 2,
  endSec: i * 2 + 2,
  interpolated: false,
  meter,
}))
const page: PageLayer = {
  partId: 'p',
  bars: [
    { bar: 1, pageIndex: 0, x: 0, y: 100, w: 100, h: 50 },
    { bar: 2, pageIndex: 0, x: 100, y: 100, w: 100, h: 50 },
    { bar: 3, pageIndex: 1, x: 0, y: 300, w: 100, h: 50 },
    { bar: 4, pageIndex: 1, x: 100, y: 300, w: 100, h: 50 },
  ],
  rests: [],
}

type Input = Parameters<typeof useEditorFollowScroll>[0]

function setup(timeSec: number, playing: boolean) {
  const view = render(<div data-testid="editor" />)
  const clock = createFollowClock(timeSec)
  const initial: Input = { clock, timeline, page, scroll: 'line', playing, containerRef: { current: view.getByTestId('editor') } }
  const hook = renderHook((input: Input) => useEditorFollowScroll(input), { initialProps: initial })
  return { clock, request: () => hook.result.current, update: (change: Partial<Input>) => hook.rerender({ ...initial, ...change }) }
}

describe('useEditorFollowScroll', () => {
  it('scrolls to the playing line while the editor plays, and again when the music moves to another line', () => {
    const { clock, request } = setup(0.5, true)
    expect(request()).toEqual({ pageIndex: 0, y: 100, at: LINE_AT })

    const first = request()
    act(() => clock.set(2.5))
    expect(request()).toBe(first)

    act(() => clock.set(4.5))
    expect(request()).toEqual({ pageIndex: 1, y: 300, at: LINE_AT })
  })

  it('never scrolls while paused, wherever the playhead goes', () => {
    const { clock, request } = setup(0.5, false)
    expect(request()).toBeNull()

    act(() => clock.set(4.5))
    expect(request()).toBeNull()
  })

  it('scrolls to where the playhead is when play starts, even on the line it was left on', () => {
    const { clock, request, update } = setup(0.5, true)
    const first = request()
    update({ playing: false })
    act(() => clock.set(4.5))
    expect(request()).toBe(first)

    act(() => clock.set(0.5))
    update({ playing: true })

    expect(request()).toEqual({ pageIndex: 0, y: 100, at: LINE_AT })
    expect(request()).not.toBe(first)
  })

  it('asks for nothing when the playhead is outside the timeline', () => {
    expect(setup(99, true).request()).toBeNull()
  })
})
