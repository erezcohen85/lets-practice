import { sharesLine } from './barLineHits'
import { boxGroup } from './boxEdits'
import { dropBoxFlag } from './boxFlags'
import { type BarBox, type BarNumber, type BoxEdges, type BoxFlag } from './types'
import { done, MIN_BOX_WIDTH, moveLineStart, refuse, withPage, type EditorDoc, type EditResult } from './pieceEdits'

// The ways to settle a box flag in the Review Queue (Decisions 2026-11-03): take the suggested left edge for a line start,
// or dismiss the flag; and, for a box Advanced Reading moved (8.22), put it back where it was. Nothing moves without the
// user, and each is one undoable step. Only a line start has a suggested edge (the processor works one out for a line's
// first box and for nothing else), so a line end has none to take.

// Edges this close (in image pixels) were touching: the same tolerance as restLabels' sameBox.
const TOUCH_PX = 1

function flagOf(doc: EditorDoc, partId: string, bar: BarNumber) {
  return doc.pages.find((page) => page.partId === partId)?.boxFlags?.find((flag) => flag.bar === bar)
}

function withoutFlag(doc: EditorDoc, partId: string, bar: BarNumber): EditorDoc {
  return { ...doc, pages: doc.pages.map((page) => (page.partId === partId ? dropBoxFlag(page, bar) : page)) }
}

/** Moves the flagged line start to the flag's suggested edge and removes the flag. Refused when there is no flag or edge, or the box cannot take the edge (see moveLineStart). */
export function applySuggestedEdge(doc: EditorDoc, partId: string, bar: BarNumber): EditResult {
  const flag = flagOf(doc, partId, bar)
  if (flag === undefined) return refuse('not-found')
  if (flag.suggestedX === null) return refuse('invalid')
  const moved = moveLineStart(doc, partId, bar, flag.suggestedX)
  return moved.ok ? done(withoutFlag(moved.doc, partId, bar), { kind: 'resolve-box-flag', bar }) : moved
}

/** Removes the flag and changes nothing else. */
export function dismissBoxFlag(doc: EditorDoc, partId: string, bar: BarNumber): EditResult {
  if (flagOf(doc, partId, bar) === undefined) return refuse('not-found')
  return done(withoutFlag(doc, partId, bar), { kind: 'resolve-box-flag', bar })
}

/** Old edges a box can go back to: finite, on the page's left side, and wide enough to be a box. */
function canRestore(previous: BoxFlag['previous']): previous is BoxEdges {
  return previous !== undefined && previous !== null && Number.isFinite(previous.x) && Number.isFinite(previous.w) && previous.x >= 0 && previous.w >= MIN_BOX_WIDTH
}

/**
 * Puts a line that Advanced Reading changed back as it was. The processor judges a line's moves as one proposal, so its
 * boxes only fit together as a set: every flag on the line of the flagged box that carries `previous` (whatever its verdict,
 * a check flag the read merged into has it too) has its place restored, on every bar that shares the place (a multi-rest),
 * and is removed. A flag with no `previous` (a read_count, a check flag) stays. A box on the line whose flag is gone (dismissed,
 * or put back before) stays where it is, unless it touched a restored edge (within a pixel, as the map has it now): then that
 * edge follows, so the line stays gap-free and the box's other edge is not undone. Refused with not-found when the bar has no
 * flag, no-box when it has no box, and invalid when the flag has no `previous`, a box (restored, or following) would be left
 * narrower than MIN_BOX_WIDTH, or old edges start before the page. One undo step; timing never changes.
 */
export function putBackBox(doc: EditorDoc, partId: string, bar: BarNumber): EditResult {
  const index = doc.pages.findIndex((page) => page.partId === partId)
  const page = index === -1 ? undefined : doc.pages[index]
  const flag = page?.boxFlags?.find((existing) => existing.bar === bar)
  if (page === undefined || flag === undefined) return refuse('not-found')
  if (flag.previous === undefined || flag.previous === null) return refuse('invalid')
  const byBar = new Map(page.bars.map((box) => [box.bar, box]))
  const clicked = boxGroup(page, bar)
  if (clicked.length === 0) return refuse('no-box')
  const place = byBar.get(clicked[0]) as BarBox

  // The flags that go back: the clicked one and every other flag with old edges on its line, in bar order.
  const going = (page.boxFlags ?? []).filter((existing) => {
    const box = byBar.get(existing.bar)
    return existing === flag || (box !== undefined && existing.previous != null && sharesLine(place, box))
  })
  const restored = new Map<BarNumber, BarBox>()
  const moves: Array<{ oldLeft: number; oldRight: number; newLeft: number; newRight: number }> = []
  for (const existing of [...going].sort((a, b) => a.bar - b.bar)) {
    const previous = existing.previous
    if (!canRestore(previous)) return refuse('invalid')
    const group = boxGroup(page, existing.bar)
    if (group.length === 0 || restored.has(group[0])) continue
    const first = byBar.get(group[0]) as BarBox
    moves.push({ oldLeft: first.x, oldRight: first.x + first.w, newLeft: previous.x, newRight: previous.x + previous.w })
    for (const member of group) restored.set(member, { ...(byBar.get(member) as BarBox), x: previous.x, w: previous.w })
  }

  // The other boxes on the line follow a restored edge they touched; a box nobody touched stays as the map has it.
  const replaced = new Map(restored)
  for (const other of page.bars) {
    if (restored.has(other.bar) || !sharesLine(place, other)) continue
    let left = other.x
    let right = other.x + other.w
    for (const move of moves) {
      if (move.newRight !== move.oldRight && Math.abs(other.x - move.oldRight) <= TOUCH_PX) left = move.newRight
      if (move.newLeft !== move.oldLeft && Math.abs(other.x + other.w - move.oldLeft) <= TOUCH_PX) right = move.newLeft
    }
    if (left !== other.x || right !== other.x + other.w) replaced.set(other.bar, { ...other, x: left, w: right - left })
  }
  if ([...replaced.values()].some((box) => box.w < MIN_BOX_WIDTH)) return refuse('invalid')

  const bars = page.bars.map((existing) => replaced.get(existing.bar) ?? existing)
  const flags = (page.boxFlags ?? []).filter((existing) => !going.includes(existing))
  return done(withPage(doc, index, bars, page.rests, flags), { kind: 'resolve-box-flag', bar })
}
