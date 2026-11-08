import { type SlotTiming } from './tempo'
import { type PageLayer } from './types'

/** Where the count sits on a part's score, in image pixels: x is the start of the bar, y the top edge of its box. */
export interface CountLabelSpot { pageIndex: number; x: number; y: number }

/**
 * Where the count of a count-in is shown: above the start of the loop's first bar, where the gliding line begins, so it
 * is never on the staff. null when the part has no box for that bar (the count is then only on the play button).
 */
export function countLabelSpot(timeline: SlotTiming[], page: PageLayer, startPosition: number): CountLabelSpot | null {
  const slot = timeline[startPosition]
  if (slot === undefined) return null
  const box = page.bars.find((candidate) => candidate.bar === slot.slot.bar)
  return box === undefined ? null : { pageIndex: box.pageIndex, x: box.x, y: box.y }
}
