import { type LoopRange } from './practice'
import { type SlotTiming } from './tempo'
import { type BarNumber } from './types'

/** Which end of a loop range. */
export type RangeEdge = 'start' | 'end'

/**
 * The position of the pass of a bar that holds the recording time or, when none does, the one nearest it; null when the
 * bar is not played. A tap on a repeated bar plays from the pass the player is in. With `timedOnly`, a pass with no locator
 * of its own (its time is an estimate, or the recording's end) is not a candidate: null when none of the bar's passes has one.
 */
export function positionNearTime(timeline: SlotTiming[], bar: BarNumber, timeSec: number, options: { timedOnly?: boolean } = {}): number | null {
  let best: number | null = null
  let bestDistance = Infinity
  timeline.forEach((played, position) => {
    if (played.slot.bar !== bar || (options.timedOnly === true && played.interpolated)) return
    const distance = timeSec < played.startSec ? played.startSec - timeSec : timeSec >= played.endSec ? timeSec - played.endSec : 0
    if (distance < bestDistance) {
      best = position
      bestDistance = distance
    }
  })
  return best
}

/** The bars a range plays, each once. */
export function barsInRange(timeline: SlotTiming[], range: LoopRange): Set<BarNumber> {
  return new Set(timeline.slice(range.startPosition, range.endPosition + 1).map((played) => played.slot.bar))
}

function withEdge(range: LoopRange, edge: RangeEdge, position: number): LoopRange | null {
  const moved = edge === 'start' ? { startPosition: position, endPosition: range.endPosition } : { startPosition: range.startPosition, endPosition: position }
  if (moved.startPosition > moved.endPosition || moved.startPosition === range.startPosition && moved.endPosition === range.endPosition) return null
  return moved
}

/**
 * The range with one edge dragged onto a bar: the pass of that bar nearest the old edge. Null when the bar is not played,
 * the edge would cross the other one, or nothing would change.
 */
export function moveRangeEdge(timeline: SlotTiming[], range: LoopRange, edge: RangeEdge, bar: BarNumber): LoopRange | null {
  const current = edge === 'start' ? range.startPosition : range.endPosition
  let best = -1
  timeline.forEach((played, position) => {
    if (played.slot.bar === bar && (best === -1 || Math.abs(position - current) < Math.abs(best - current))) best = position
  })
  return best === -1 ? null : withEdge(range, edge, best)
}

/** The range with one edge moved by `delta` positions; null at the ends of the piece, when it would cross the other edge, or for no move. */
export function nudgeRangeEdge(timeline: SlotTiming[], range: LoopRange, edge: RangeEdge, delta: number): LoopRange | null {
  const position = (edge === 'start' ? range.startPosition : range.endPosition) + delta
  if (position < 0 || position >= timeline.length) return null
  return withEdge(range, edge, position)
}
