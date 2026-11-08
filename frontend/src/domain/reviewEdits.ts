import { dropBoxFlag } from './boxFlags'
import { done, refuse, type EditorDoc, type EditResult } from './pieceEdits'
import { reviewItems, type ReviewItem } from './reviewQueue'
import { type Locator } from './types'

// "Resolve all" of the Review Queue (Erez, 2026-11-06): one undoable step that checks every open flag item and dismisses
// the part's box flags. What only fixing removes (a bar without a time, a part whose bar count differs) stays in the list.

type Open = Extract<ReviewItem, { kind: 'flag' }> | Extract<ReviewItem, { kind: 'box' }>

/** The items Resolve all can settle: flag items not yet checked (or still moved), and the part's box flags. */
function openItems(doc: EditorDoc, partId: string): Open[] {
  return reviewItems(doc, partId).filter((item): item is Open => (item.kind === 'flag' && (item.moved || !item.checked)) || item.kind === 'box')
}

/** Whether Resolve all would do anything: there is a flag item left to check or a box flag to dismiss. */
export function canResolveAll(doc: EditorDoc, partId: string): boolean {
  return openItems(doc, partId).length > 0
}

/**
 * Checks every open flag item and dismisses this part's box flags, in one step. A moved item is checked as Resolved does
 * (it leaves the moved list and its time stays), any other as "Sounds right" does (confirmed and checked, time unchanged).
 * Refused with 'not-found' when there is nothing to settle.
 */
export function resolveAllOpen(doc: EditorDoc, partId: string): EditResult {
  const items = openItems(doc, partId)
  if (items.length === 0) return refuse('not-found')
  const flagged = items.filter((item): item is Extract<Open, { kind: 'flag' }> => item.kind === 'flag')
  const patch = (locator: Locator): Locator => {
    const item = flagged.find((candidate) => candidate.bar === locator.bar && candidate.passIndex === locator.passIndex)
    if (item === undefined) return locator
    return item.moved ? { ...locator, checked: true } : { ...locator, confirmed: true, checked: true }
  }
  const resolvedMoved = (bar: number, passIndex: number) => flagged.some((item) => item.moved && item.bar === bar && item.passIndex === passIndex)
  const boxBars = items.filter((item) => item.kind === 'box').map((item) => item.bar)
  const next: EditorDoc = {
    ...doc,
    timing: flagged.length === 0 ? doc.timing : { ...doc.timing, locators: doc.timing.locators.map(patch) },
    moved: doc.moved === undefined ? undefined : doc.moved.filter((entry) => !resolvedMoved(entry.bar, entry.passIndex)),
    pages: doc.pages.map((page) => (page.partId === partId ? boxBars.reduce(dropBoxFlag, page) : page)),
  }
  if (doc.moved === undefined) delete next.moved
  return done(next, { kind: 'resolve-all' })
}
