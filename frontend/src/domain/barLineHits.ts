import { type BarBox, type BarNumber } from './types'

/** How close to a bar line, in image pixels, a pointer is said to be on it. */
export const LINE_HIT_RADIUS = 8

// Two edges closer than this, in image pixels, are one line: a moved line can differ in the last digits of a float, and
// on a deskewed page the boxes of neighbouring bars overlap or gap by a pixel or two (3 px is about a third of a
// millimetre at 200 DPI).
const EDGE_TOLERANCE = 3

/** The bar line after bar `bar`: where the box before it ends, on page `pageIndex`. */
export interface BarLineGeometry { bar: BarNumber; pageIndex: number; x: number; y: number; h: number }

/** The left edge of the first box of a staff line: the bar is the first of its line (or of its multi-rest). */
export interface LineStartGeometry { bar: BarNumber; pageIndex: number; x: number; y: number; h: number }

/** The right edge of the last box of a staff line: the bar is the last of its line (or of its multi-rest). */
export interface LineEndGeometry { bar: BarNumber; pageIndex: number; x: number; y: number; h: number }

/** Which end of a staff line a handle sits on. */
export type LineEdge = 'start' | 'end'

// A signature printed at the start of a bar leaves a gap of between these many box heights before its box (a key
// signature is a staff space or more wide, a box about six): a few pixels apart is a deskewed page, not a signature.
const MIN_GAP_HEIGHTS = 0.08
const MAX_GAP_HEIGHTS = 1.5
// The clef, key and time signature before the first box of a line reach at most this many box heights to its left.
const OPENING_HEIGHTS = 3

/** Two boxes on one staff line: the same page and a vertical range in common. */
export function sharesLine(box: BarBox, other: BarBox): boolean {
  return box.pageIndex === other.pageIndex && box.y < other.y + other.h && other.y < box.y + box.h
}

/**
 * The space between a box and the one after it on the same line: 0 where they touch (float noise counts as touching),
 * the width of the signature where a bar starts after one. null when `next` is not the box after `box` on that line.
 */
export function gapBetween(box: BarBox, next: BarBox): number | null {
  if (!sharesLine(box, next)) return null
  const gap = next.x - (box.x + box.w)
  const height = Math.min(box.h, next.h)
  if (gap < -EDGE_TOLERANCE || gap > MAX_GAP_HEIGHTS * height) return null
  if (gap <= EDGE_TOLERANCE) return 0
  return gap >= MIN_GAP_HEIGHTS * height ? gap : null
}

/**
 * Every bar line of a part's boxes. The first and the last edge of a staff line are not bar lines to edit: they have
 * no box on the other side (the same test as the line-end refusal of domain/pieceEdits); they are the ends of the line
 * (`lineStarts`, `lineEnds`), with a handle of their own. Two boxes with a gap between
 * them (a signature at the start of the second) have a bar line at the end of the first.
 */
export function barLines(boxes: readonly BarBox[]): BarLineGeometry[] {
  const byBar = new Map(boxes.map((box) => [box.bar, box]))
  const lines: BarLineGeometry[] = []
  for (const box of boxes) {
    const next = byBar.get(box.bar + 1)
    if (next === undefined || gapBetween(box, next) === null) continue
    const y = Math.min(box.y, next.y)
    // Touching boxes share the line at the next box's edge; with a gap the line is where the box before ends.
    lines.push({ bar: box.bar, pageIndex: box.pageIndex, x: gapBetween(box, next) === 0 ? next.x : box.x + box.w, y, h: Math.max(box.y + box.h, next.y + next.h) - y })
  }
  return lines
}

/** A box with another box before it on its line (a gap or not). */
export function hasBoxBefore(boxes: readonly BarBox[], box: BarBox): boolean {
  return boxes.some((other) => other !== box && sharesLine(box, other) && other.x < box.x && other.x + other.w <= box.x + EDGE_TOLERANCE)
}

/** A box with another box after it on its line: the mirror of `hasBoxBefore` (a multi-rest's boxes share one place, so they are not after each other). */
export function hasBoxAfter(boxes: readonly BarBox[], box: BarBox): boolean {
  return boxes.some((other) => other !== box && sharesLine(box, other) && other.x > box.x && other.x >= box.x + box.w - EDGE_TOLERANCE)
}

/** The box that starts at the same place as an earlier bar's: the later bars of a multi-rest. */
function repeatsEarlier(boxes: readonly BarBox[], box: BarBox): boolean {
  return boxes.some(
    (other) => other.bar < box.bar && other.pageIndex === box.pageIndex && other.x === box.x && other.y === box.y && other.w === box.w && other.h === box.h,
  )
}

/** The start of every staff line; the boxes of a multi-rest, which share one place, give one start. */
export function lineStarts(boxes: readonly BarBox[]): LineStartGeometry[] {
  return boxes
    .filter((box) => !hasBoxBefore(boxes, box) && !repeatsEarlier(boxes, box))
    .map((box) => ({ bar: box.bar, pageIndex: box.pageIndex, x: box.x, y: box.y, h: box.h }))
}

/** The end of every staff line; the boxes of a multi-rest, which share one place, give one end (named by the first of them). */
export function lineEnds(boxes: readonly BarBox[]): LineEndGeometry[] {
  return boxes
    .filter((box) => !hasBoxAfter(boxes, box) && !repeatsEarlier(boxes, box))
    .map((box) => ({ bar: box.bar, pageIndex: box.pageIndex, x: box.x + box.w, y: box.y, h: box.h }))
}

/** The edge in `edges` within `radius` of the point on `pageIndex`, over its height (the nearest one), or null. */
function nearestEdge<T extends { pageIndex: number; x: number; y: number; h: number }>(
  edges: readonly T[],
  pageIndex: number,
  x: number,
  y: number,
  radius: number,
): T | null {
  let best: T | null = null
  for (const edge of edges) {
    if (edge.pageIndex !== pageIndex || y < edge.y || y > edge.y + edge.h) continue
    const distance = Math.abs(x - edge.x)
    if (distance <= radius && (best === null || distance < Math.abs(x - best.x))) best = edge
  }
  return best
}

/** The bar line within `radius` of the point (the nearest one), or null. */
export function barLineAt(
  boxes: readonly BarBox[],
  pageIndex: number,
  x: number,
  y: number,
  radius: number = LINE_HIT_RADIUS,
): BarLineGeometry | null {
  return nearestEdge(barLines(boxes), pageIndex, x, y, radius)
}

/** The box under the point (a point on a shared edge belongs to the box on its right), or null. */
export function barAt(boxes: readonly BarBox[], pageIndex: number, x: number, y: number): BarBox | null {
  return (
    boxes.find((box) => box.pageIndex === pageIndex && x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) ?? null
  )
}

/** The start of a line within `radius` of the point (the nearest one), or null. */
export function lineStartAt(
  boxes: readonly BarBox[],
  pageIndex: number,
  x: number,
  y: number,
  radius: number = LINE_HIT_RADIUS,
): LineStartGeometry | null {
  return nearestEdge(lineStarts(boxes), pageIndex, x, y, radius)
}

/** The end of a line within `radius` of the point (the nearest one), or null. */
export function lineEndAt(
  boxes: readonly BarBox[],
  pageIndex: number,
  x: number,
  y: number,
  radius: number = LINE_HIT_RADIUS,
): LineEndGeometry | null {
  return nearestEdge(lineEnds(boxes), pageIndex, x, y, radius)
}

/** The start or the end of a line within `radius` of the point, whichever is nearer, with the side it is. */
export function lineEdgeAt(
  boxes: readonly BarBox[],
  pageIndex: number,
  x: number,
  y: number,
  radius: number = LINE_HIT_RADIUS,
): (LineStartGeometry & { edge: LineEdge }) | null {
  const start = lineStartAt(boxes, pageIndex, x, y, radius)
  const end = lineEndAt(boxes, pageIndex, x, y, radius)
  if (start === null && end === null) return null
  if (end === null || (start !== null && Math.abs(x - start.x) <= Math.abs(x - end.x))) return { ...(start as LineStartGeometry), edge: 'start' }
  return { ...end, edge: 'end' }
}

/**
 * The bar a tap or click means: the box under the point, else the bar that follows the point on its line when the
 * point is in the gap before it (a signature) or in the clef, key and time signature before the first box of a line.
 */
export function barUnderPoint(boxes: readonly BarBox[], pageIndex: number, x: number, y: number): BarBox | null {
  const inside = barAt(boxes, pageIndex, x, y)
  if (inside !== null) return inside
  let found: BarBox | null = null
  for (const box of boxes) {
    if (box.pageIndex !== pageIndex || y < box.y || y >= box.y + box.h || x >= box.x) continue
    const before = boxes.filter((other) => other !== box && sharesLine(box, other) && other.x < box.x)
    const reach = before.length === 0 ? Math.max(0, box.x - OPENING_HEIGHTS * box.h) : Math.max(...before.map((other) => other.x + other.w))
    if (x >= reach && (found === null || box.x < found.x)) found = box
  }
  return found
}
