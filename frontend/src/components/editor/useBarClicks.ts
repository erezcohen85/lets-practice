import { useRef } from 'react'
import { barLineAt, barUnderPoint, lineEdgeAt } from '@/domain/barLineHits'
import { type BarBox, type BarNumber } from '@/domain/types'
import { CLICK_SLOP } from '@/components/score/useEditLayer'
import { type ScorePointerEvent } from '@/components/score/ScoreView'
import { type EditMode } from '@/lib/useEditorDoc'

/** A second click on the same bar within this long (ms) is a double click. */
export const DOUBLE_CLICK_MS = 350

/**
 * The clicks on a bar of the score in Move mode, for the page's one selection (view state, never recorded in the
 * history). A press on a bar line or on the start or the end of a line is a drag, not a click on a bar.
 * A second click on the same bar within DOUBLE_CLICK_MS, with no drag, reports `again`: the page then steps to the next
 * pass of a repeated bar. Clicks are counted here by time and bar from pointer events, so touch takes the same path.
 */
export function useBarClicks(boxes: readonly BarBox[], mode: EditMode, onBar: (bar: BarNumber, again: boolean) => void) {
  const press = useRef<ScorePointerEvent | null>(null)
  const last = useRef<{ bar: BarNumber; at: number } | null>(null)

  function onPointer(event: ScorePointerEvent) {
    if (mode !== 'move') {
      press.current = null
      last.current = null
      return
    }
    if (event.type === 'down') {
      const onHandle = barLineAt(boxes, event.pageIndex, event.x, event.y) !== null || lineEdgeAt(boxes, event.pageIndex, event.x, event.y) !== null
      press.current = onHandle ? null : event
    } else if (event.type === 'leave') {
      press.current = null
    } else if (event.type === 'up') {
      const pressed = press.current
      press.current = null
      if (pressed === null || pressed.pageIndex !== event.pageIndex || Math.hypot(event.x - pressed.x, event.y - pressed.y) > CLICK_SLOP) {
        last.current = null
        return
      }
      const box = barUnderPoint(boxes, event.pageIndex, event.x, event.y)
      if (box === null) {
        last.current = null
        return
      }
      const now = Date.now()
      const again = last.current !== null && last.current.bar === box.bar && now - last.current.at <= DOUBLE_CLICK_MS
      // A double click is used up: the next click starts a new one.
      last.current = again ? null : { bar: box.bar, at: now }
      onBar(box.bar, again)
    }
  }

  return { onPointer }
}
