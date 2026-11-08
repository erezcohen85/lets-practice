import { boxGroup } from './boxEdits'
import { flagsOnBoxes, pageWithFlags, shiftFlags } from './boxFlags'
import { addBarLine, deleteBarLine, done, MIN_BOX_WIDTH, refuse, type EditorDoc, type EditResult } from './pieceEdits'
import { hasPickup } from './shortBars'
import { type BarBox, type BarNumber } from './types'

// This part > Bars (Decisions 2026-11-06): Insert and Remove by bar number, and the two ways to give a part the piece's
// pickup. Every edit here changes the open part's boxes, rests and flags only; the timing and the other parts keep their
// reference, and the part's boxes stay numbered without gaps, as partBarCount expects.

/** The share of a box's width the new bar takes when a bar is inserted, and the pickup takes when the first box is split. */
export const PART_NEW_BAR_SHARE = 0.25

function indexOf(doc: EditorDoc, partId: string): number {
  return doc.pages.findIndex((page) => page.partId === partId)
}

/**
 * Inserts a bar before or after bar `bar` of part `partId` by splitting its box: before, the new bar is the narrow left
 * 25 % and takes number `bar`; after, it is the narrow right 25 % and takes number `bar + 1`. This part's later boxes, rests
 * and flags renumber one up. A box that holds several bars, or one too narrow to keep the narrow side's minimum width, is refused.
 */
export function insertPartBar(doc: EditorDoc, partId: string, bar: BarNumber, side: 'before' | 'after'): EditResult {
  const index = indexOf(doc, partId)
  const page = index === -1 ? undefined : doc.pages[index]
  const box = page?.bars.find((existing) => existing.bar === bar)
  if (page === undefined || box === undefined) return refuse('no-box')
  if (boxGroup(page, bar).length > 1) return refuse('in-multi-rest')
  const share = side === 'before' ? PART_NEW_BAR_SHARE : 1 - PART_NEW_BAR_SHARE
  return addBarLine(doc, partId, bar, box.x + box.w * share)
}

/**
 * Removes bar `bar` of part `partId` by merging its box with the next one, or with the one before when the next is on
 * another staff line (or `bar` is last). This part's later boxes, rests and flags renumber one down. A multi-rest is refused.
 */
export function removePartBar(doc: EditorDoc, partId: string, bar: BarNumber): EditResult {
  const index = indexOf(doc, partId)
  const page = index === -1 ? undefined : doc.pages[index]
  if (page === undefined || !page.bars.some((box) => box.bar === bar)) return refuse('no-box')
  if (page.bars.length === 1) return refuse('only-bar')
  const single = (n: BarNumber) => boxGroup(page, n).length === 1
  if (!single(bar)) return refuse('in-multi-rest')
  // A line is deleted after its left bar: bar itself (merging with the next), or bar - 1 (merging with the one before).
  let first: EditResult | null = null
  for (const left of [bar, bar - 1]) {
    if (!page.bars.some((box) => box.bar === left) || !single(left) || !single(left + 1)) continue
    const result = deleteBarLine(doc, partId, left)
    if (result.ok) return result
    first ??= result
  }
  return first ?? refuse('in-multi-rest')
}

/** The reason a part cannot take the piece's pickup, or the part's index. */
function pickupTarget(doc: EditorDoc, partId: string) {
  const index = indexOf(doc, partId)
  if (index === -1) return refuse('no-box')
  if (!hasPickup(doc.timing)) return refuse('no-piece-pickup')
  if (doc.pages[index].bars.some((box) => box.bar === 0)) return refuse('part-has-pickup')
  return index
}

/**
 * "Split the first box": the left 25 % of this part's box 1, which holds the pickup and bar 1 together, becomes box 0; the
 * rest stays box 1 and every other number stays. Refused when the piece has no pickup, the part has a box 0 already, the first
 * box holds several bars or is too narrow.
 */
export function splitPartPickup(doc: EditorDoc, partId: string): EditResult {
  const index = pickupTarget(doc, partId)
  if (typeof index !== 'number') return index
  const page = doc.pages[index]
  const first = page.bars.find((box) => box.bar === 1)
  if (first === undefined) return refuse('no-box')
  if (boxGroup(page, 1).length > 1) return refuse('in-multi-rest')
  const width = first.w * PART_NEW_BAR_SHARE
  if (width < MIN_BOX_WIDTH || first.w - width < MIN_BOX_WIDTH) return refuse('too-narrow')
  const pickup: BarBox = { ...first, bar: 0, w: width }
  const rest: BarBox = { ...first, x: first.x + width, w: first.w - width }
  const bars = [pickup, ...page.bars.map((box) => (box.bar === 1 ? rest : box))]
  const next = pageWithFlags({ partId: page.partId, bars, rests: page.rests }, flagsOnBoxes(page.boxFlags, bars))
  return done({ ...doc, pages: doc.pages.map((existing, i) => (i === index ? next : existing)) }, { kind: 'split-part-pickup', bar: 0 })
}

/**
 * "The first box is the pickup": this part's boxes, rests and flags all move one number down, so its box 1 becomes box 0.
 * Refused when the piece has no pickup or the part has a box 0 already.
 */
export function shiftPartPickup(doc: EditorDoc, partId: string): EditResult {
  const index = pickupTarget(doc, partId)
  if (typeof index !== 'number') return index
  const page = doc.pages[index]
  const next = pageWithFlags(
    { partId: page.partId, bars: page.bars.map((box) => ({ ...box, bar: box.bar - 1 })), rests: page.rests.map((bar) => bar - 1) },
    shiftFlags(page.boxFlags, -1),
  )
  return done({ ...doc, pages: doc.pages.map((existing, i) => (i === index ? next : existing)) }, { kind: 'shift-part-pickup', bar: 0 })
}
