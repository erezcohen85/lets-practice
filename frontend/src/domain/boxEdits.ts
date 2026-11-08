import { addBarLine, deleteBarLine, done, refuse, withPage, withTiming, type EditorDoc, type EditResult } from './pieceEdits'
import { deleteBarFromTiming, insertBarInTiming } from './renumber'
import { sameBox } from './restLabels'
import { type BarBox, type BarNumber, type ClickMode, type Locator, type PageLayer, type TimingLayer } from './types'

// "Bars in this box" (a multi-bar rest made or undone by hand) and the piece variants of the bar-count edits, which
// "Edit piece structure" turns on (Decisions 2026-11-03): the open part's edit, then the same bars added to or taken
// from the piece's timing. No other part's boxes or rests change.

export const MAX_BARS_IN_BOX = 999

/** The bars whose boxes sit at the same place as `bar`'s, in order (one bar, or a multi-rest's run); [] with no box. */
export function boxGroup(page: PageLayer, bar: BarNumber): BarNumber[] {
  const byBar = new Map(page.bars.map((box) => [box.bar, box]))
  const box = byBar.get(bar)
  if (box === undefined) return []
  const joins = (n: BarNumber) => {
    const other = byBar.get(n)
    return other !== undefined && sameBox(other, box)
  }
  let first = bar
  while (joins(first - 1)) first--
  let last = bar
  while (joins(last + 1)) last++
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
}

function range(first: BarNumber, last: BarNumber): BarNumber[] {
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i)
}

/**
 * Part only: the box of `bar` holds `count` bars. More bars are copies of the box after its group, fewer are taken off
 * the group's end; the part's later boxes and rests renumber, and with 2 or more every bar of the box is a rest. The
 * timing and the other parts keep their reference.
 */
export function setBarsInBox(doc: EditorDoc, partId: string, bar: BarNumber, count: number): EditResult {
  const index = doc.pages.findIndex((page) => page.partId === partId)
  const page = index === -1 ? undefined : doc.pages[index]
  const group = page === undefined ? [] : boxGroup(page, bar)
  if (page === undefined || group.length === 0) return refuse('no-box')
  if (!Number.isInteger(count) || count < 1 || count > MAX_BARS_IN_BOX || count === group.length) return refuse('invalid')
  const first = group[0]
  const last = group[group.length - 1]
  const d = count - group.length
  const box = page.bars.find((b) => b.bar === first) as BarBox
  const shift = (n: BarNumber) => (n > last ? n + d : n)
  let bars: BarBox[]
  let rests: BarNumber[]
  const lost = (n: BarNumber) => d < 0 && n > last + d && n <= last
  const flags = (page.boxFlags ?? []).filter((flag) => !lost(flag.bar)).map((flag) => ({ ...flag, bar: shift(flag.bar) }))
  if (d > 0) {
    const copies = range(last + 1, last + d).map((n) => ({ ...box, bar: n }))
    bars = page.bars.flatMap((b) => (b.bar === last ? [b, ...copies] : [{ ...b, bar: shift(b.bar) }]))
    rests = page.rests.map(shift)
  } else {
    const dropped = (n: BarNumber) => n > last + d && n <= last
    bars = page.bars.filter((b) => !dropped(b.bar)).map((b) => (b.bar > last ? { ...b, bar: shift(b.bar) } : b))
    rests = page.rests.filter((n) => !dropped(n)).map(shift)
  }
  if (count >= 2) rests = [...new Set([...rests, ...range(first, first + count - 1)])].sort((a, b) => a - b)
  return done(withPage(doc, index, bars, rests, flags), { kind: 'set-bars-in-box', bar: first, count })
}

/** The timing with `times` bars inserted at `at`, or deleted from `at` on, and the locators those edits dropped. */
function repeatInTiming(timing: TimingLayer, at: BarNumber, times: number, mode: ClickMode): { timing: TimingLayer; dropped: Locator[] } {
  let current = timing
  const dropped: Locator[] = []
  for (let i = 0; i < Math.abs(times); i++) {
    const edit = times > 0 ? insertBarInTiming(current, at, mode) : deleteBarFromTiming(current, at, mode)
    current = edit.timing
    dropped.push(...edit.droppedLocators)
  }
  return { timing: current, dropped }
}

/** Edit piece structure on: the bar line added in `bar`'s box of the part, and bar+1 inserted into the piece. */
export function addBarLineInPiece(doc: EditorDoc, partId: string, bar: BarNumber, x: number, mode: ClickMode): EditResult {
  const part = addBarLine(doc, partId, bar, x)
  if (!part.ok) return part
  if (bar + 1 > doc.timing.barCount + 1) return refuse('invalid')
  const edit = repeatInTiming(doc.timing, bar + 1, 1, mode)
  return done(withTiming(part.doc, edit.timing), { kind: 'add-piece-bar-line', bar }, edit.dropped)
}

/** Edit piece structure on: the bar line after `bar` deleted in the part, and bar+1 removed from the piece. */
export function deleteBarLineInPiece(doc: EditorDoc, partId: string, bar: BarNumber, mode: ClickMode): EditResult {
  const part = deleteBarLine(doc, partId, bar)
  if (!part.ok) return part
  if (bar + 1 > doc.timing.barCount) return refuse('invalid')
  const edit = repeatInTiming(doc.timing, bar + 1, -1, mode)
  return done(withTiming(part.doc, edit.timing), { kind: 'delete-piece-bar-line', bar }, edit.dropped)
}

/** Edit piece structure on: Bars in this box on the part, and the same bars added to or taken from the piece at the box's end. */
export function setBarsInBoxInPiece(doc: EditorDoc, partId: string, bar: BarNumber, count: number, mode: ClickMode): EditResult {
  const part = setBarsInBox(doc, partId, bar, count)
  if (!part.ok) return part
  const page = doc.pages.find((p) => p.partId === partId) as PageLayer
  const group = boxGroup(page, bar)
  const last = group[group.length - 1]
  const d = count - group.length
  const at = d > 0 ? last + 1 : last + d + 1
  if (d > 0 ? at > doc.timing.barCount + 1 : last > doc.timing.barCount || doc.timing.barCount + d < 1) return refuse('invalid')
  const edit = repeatInTiming(doc.timing, at, d, mode)
  return done(withTiming(part.doc, edit.timing), { kind: 'set-piece-bars-in-box', bar: group[0], count }, edit.dropped)
}
