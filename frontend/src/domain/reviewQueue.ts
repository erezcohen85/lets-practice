import { partProblems, type EditorDoc, type PartProblem } from './pieceEdits'
import { expandPlayOrder } from './playOrder'
import { locatorsBySlot } from './renumber'
import { type BarNumber, type BoxFlag, type PageLayer, type ReviewFlag, type TimingLayer } from './types'

/** One row of the Review Queue (Decision 2026-10-29: the review state lives on the locators; part problems and bars without a time are worked out from the map). */
export type ReviewItem =
  | { kind: 'part'; problem: PartProblem }
  | { kind: 'box'; bar: BarNumber; flag: BoxFlag }
  | { kind: 'unmatched'; bar: BarNumber; passIndex: number }
  | { kind: 'flag'; bar: BarNumber; passIndex: number; timeSec: number; flags: ReviewFlag[]; checked: boolean; moved: boolean }

/** The items every part of the piece shares: the flagged or hand-moved locators and the bars without a locator, in play order. */
function timingItems(doc: EditorDoc): ReviewItem[] {
  const { timing } = doc
  if (timing.barCount < 1) return []
  const located = locatorsBySlot(timing)
  return expandPlayOrder(timing.playOrder, timing.barCount).flatMap((slot): ReviewItem[] => {
    const locator = located[slot.position]
    if (locator === null) return [{ kind: 'unmatched', bar: slot.bar, passIndex: slot.passIndex }]
    const flags = locator.flags ?? []
    const moved = doc.moved?.some((m) => m.bar === slot.bar && m.passIndex === slot.passIndex) ?? false
    // A locator dragged by hand is an item until it is Resolved or its move is undone, flag or not: its card holds those buttons.
    if (flags.length === 0 && !moved) return []
    return [
      {
        kind: 'flag',
        bar: slot.bar,
        passIndex: slot.passIndex,
        timeSec: locator.timeSec,
        flags,
        checked: locator.checked === true,
        moved,
      },
    ]
  })
}

/** One item per box the box check flagged in the part, in bar order. */
function boxItems(page: PageLayer | undefined): ReviewItem[] {
  return [...(page?.boxFlags ?? [])].sort((a, b) => a.bar - b.bar).map((flag): ReviewItem => ({ kind: 'box', bar: flag.bar, flag }))
}

/** Part problems first, then the part's box-check flags, then flag and unmatched items in play order. */
export function reviewItems(doc: EditorDoc, partId: string): ReviewItem[] {
  const page = doc.pages.find((existing) => existing.partId === partId)
  return [
    ...partProblems(doc, partId).map((problem): ReviewItem => ({ kind: 'part', problem })),
    ...boxItems(page),
    ...timingItems(doc),
  ]
}

export interface ReviewCounts { checked: number; total: number; moved: number; open: number }

/** total: every item; checked: the checked flag items (a part, box or unmatched item is never checked: fixing it removes it); moved: dragged and not yet checked; open: total - checked. */
export function reviewCounts(items: ReviewItem[]): ReviewCounts {
  const flags = items.filter((item): item is Extract<ReviewItem, { kind: 'flag' }> => item.kind === 'flag')
  const checked = flags.filter((item) => item.checked).length
  return {
    checked,
    total: items.length,
    moved: flags.filter((item) => item.moved && !item.checked).length,
    open: items.length - checked,
  }
}

/** N: the next item after index `from` that is not checked, wrapping; null when every item is checked. */
export function nextProblem(items: ReviewItem[], from: number | null): number | null {
  const start = from === null ? 0 : from + 1
  for (let step = 0; step < items.length; step++) {
    const index = (start + step) % items.length
    const item = items[index]
    if (!(item.kind === 'flag' && item.checked)) return index
  }
  return null
}

function checkedAndTotal(items: ReviewItem[]): { checked: number; total: number } {
  const { checked, total } = reviewCounts(items)
  return { checked, total }
}

/** The hub status of a part, from the map (Decision 2026-10-29: the review state lives on the locators). */
export function partReview(timing: TimingLayer, page: PageLayer): { checked: number; total: number } {
  return checkedAndTotal(reviewItems({ timing, pages: [page] }, page.partId))
}

/** The Library status of a piece: the shared timing items once, plus every part's own problems. */
export function pieceReview(timing: TimingLayer, pages: PageLayer[]): { checked: number; total: number } {
  const doc: EditorDoc = { timing, pages }
  const own: ReviewItem[] = pages.flatMap((page) => [
    ...partProblems(doc, page.partId).map((problem): ReviewItem => ({ kind: 'part', problem })),
    ...boxItems(page),
  ])
  return checkedAndTotal([...timingItems(doc), ...own])
}
