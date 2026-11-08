import { type BarBox, type BarNumber } from './types'

export type BarStep = 'left' | 'right' | 'up' | 'down'

/**
 * The bar the arrow keys go to from `current` on a part's score: left and right step to the previous and next bar
 * (through each bar of a multi-rest, though they share one box), up and down to the bar of the line above or below
 * whose middle is nearest across, over page ends too. At the first or last bar or line it stays. With no selection,
 * or a bar the part has no box for, it starts on the first bar; null for a part without boxes.
 */
export function neighbourBar(bars: readonly BarBox[], current: BarNumber | null, step: BarStep): BarNumber | null {
  const numbers = [...new Set(bars.map((box) => box.bar))].sort((a, b) => a - b)
  if (numbers.length === 0) return null
  const from = current === null ? undefined : bars.find((box) => box.bar === current)
  if (from === undefined || current === null) return numbers[0]
  if (step === 'left' || step === 'right') {
    const index = numbers.indexOf(current) + (step === 'right' ? 1 : -1)
    return numbers[Math.min(numbers.length - 1, Math.max(0, index))]
  }
  const lines = linesOf(bars)
  const at = lines.findIndex((line) => line.some((box) => box.bar === current))
  const target = lines[at + (step === 'down' ? 1 : -1)]
  if (target === undefined) return current
  const middle = from.x + from.w / 2
  let best = target[0]
  for (const box of target) {
    const distance = Math.abs(box.x + box.w / 2 - middle)
    const bestDistance = Math.abs(best.x + best.w / 2 - middle)
    if (distance < bestDistance || (distance === bestDistance && box.bar < best.bar)) best = box
  }
  return best.bar
}

/** The boxes grouped into lines of the score, in reading order: by page, then top to bottom. A box whose middle falls
 * within a line's height belongs to that line. */
function linesOf(bars: readonly BarBox[]): BarBox[][] {
  const sorted = [...bars].sort((a, b) => a.pageIndex - b.pageIndex || a.y + a.h / 2 - (b.y + b.h / 2))
  const lines: BarBox[][] = []
  for (const box of sorted) {
    const line = lines.at(-1)
    const first = line?.[0]
    const middle = box.y + box.h / 2
    if (line !== undefined && first !== undefined && first.pageIndex === box.pageIndex && middle >= first.y && middle <= first.y + first.h) {
      line.push(box)
    } else lines.push([box])
  }
  return lines
}
