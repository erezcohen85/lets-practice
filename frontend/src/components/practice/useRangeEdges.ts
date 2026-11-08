import { useCallback, useEffect, useRef } from 'react'
import { type LoopRange } from '@/domain/practice'
import { moveRangeEdge, nudgeRangeEdge, type RangeEdge } from '@/domain/rangeEdges'
import { type SlotTiming } from '@/domain/tempo'
import { type BarBox } from '@/domain/types'
import { type PageImage } from '@/lib/dataClient'
import { barAtClientPoint } from './barAtPoint'

export interface RangeEdges {
  /** A pointer went down on an edge handle: until it is lifted, the edge follows the bar under the pointer. */
  startDrag(edge: RangeEdge): void
  /** A key moved an edge by this many bars. */
  nudge(edge: RangeEdge, delta: number): void
}

/**
 * Moving the ends of the loop range by whole bars. The drag listens on the window, not on the handle: the handle is
 * drawn on whichever page its bar is on, so it is a new element when the edge crosses to the next page.
 */
export function useRangeEdges({
  range,
  timeline,
  bars,
  pages,
  onChange,
}: {
  range: LoopRange | null
  timeline: SlotTiming[]
  bars: readonly BarBox[]
  pages: readonly PageImage[]
  onChange(range: LoopRange): void
}): RangeEdges {
  const latest = useRef({ range, timeline, bars, pages, onChange })
  useEffect(() => {
    latest.current = { range, timeline, bars, pages, onChange }
  })
  const stopDrag = useRef<(() => void) | null>(null)

  useEffect(() => () => stopDrag.current?.(), [])

  const startDrag = useCallback((edge: RangeEdge) => {
    stopDrag.current?.()
    const onMove = (event: PointerEvent) => {
      const { range: current, timeline: slots, bars: boxes, pages: images, onChange: change } = latest.current
      if (current === null) return
      const bar = barAtClientPoint(event.clientX, event.clientY, images, boxes)
      if (bar === null) return
      const next = moveRangeEdge(slots, current, edge, bar)
      if (next !== null) change(next)
    }
    const end = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      stopDrag.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    stopDrag.current = end
  }, [])

  const nudge = useCallback((edge: RangeEdge, delta: number) => {
    const { range: current, timeline: slots, onChange: change } = latest.current
    if (current === null) return
    const next = nudgeRangeEdge(slots, current, edge, delta)
    if (next !== null) change(next)
  }, [])

  return { startDrag, nudge }
}
