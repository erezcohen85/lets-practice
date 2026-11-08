import { type BarNames } from './barNames'
import { type BarBox, type BarNumber } from './types'

// Boxes this close (in image pixels) count as one printed box.
const SAME_BOX_PX = 1

/** Two boxes at one place: the bars of a multi-bar rest share one printed box. */
export function sameBox(a: BarBox, b: BarBox): boolean {
  return (
    a.pageIndex === b.pageIndex &&
    Math.abs(a.x - b.x) <= SAME_BOX_PX &&
    Math.abs(a.y - b.y) <= SAME_BOX_PX &&
    Math.abs(a.w - b.w) <= SAME_BOX_PX &&
    Math.abs(a.h - b.h) <= SAME_BOX_PX
  )
}

/**
 * The bar label to draw on the score ("7", "p7"), keyed by the internal bar that carries it. A multi-bar rest is one printed measure
 * whose bars all share one box, so its numbers would pile up; consecutive bars on the same box get one range ("18–28")
 * on the first of them, and the others get no entry. Every other bar gets its own number.
 */
export function restLabels(boxes: readonly BarBox[], names: BarNames): Map<BarNumber, string> {
  const labels = new Map<BarNumber, string>()
  const sorted = [...boxes].sort((a, b) => a.bar - b.bar)
  let index = 0
  while (index < sorted.length) {
    const first = sorted[index]
    let last = first
    for (let next = index + 1; next < sorted.length; next++) {
      if (sorted[next].bar !== last.bar + 1 || !sameBox(first, sorted[next])) break
      last = sorted[next]
      index = next
    }
    labels.set(first.bar, last === first ? names.label(first.bar) : `${names.label(first.bar)}–${names.label(last.bar)}`)
    index++
  }
  return labels
}
