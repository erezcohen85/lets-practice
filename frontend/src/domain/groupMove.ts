import { CLOSEST_SNAP_SEC, type DetectedBeat, nearestBeat, type SnapDirection, snapToBeat } from './beats'
import { isSelected, type Slot } from './locatorSelection'
import { done, refuse, type EditResult, type EditorDoc } from './pieceEdits'
import { dragLocator } from './timingEdits'

// Moving several locators at once. The rules are the single move's: order kept, never past a neighbour that is not
// selected, every moved locator a fixed point. A group move is a fold of single moves, so those rules are not repeated.

/** A selected locator stays this far (in seconds) from a neighbour that is not selected, so a drop never lands on one. */
export const MIN_GAP_SEC = 0.01

export type TimedSlot = Slot & { timeSec: number }

const byTime = (a: TimedSlot, b: TimedSlot) => a.timeSec - b.timeSec

/**
 * How far the selection can move together, in seconds: `min` (earlier, <= 0) to `max` (later, >= 0). Each selected
 * locator is held back by the nearest locator that is not selected on its side, and by the recording's ends.
 */
export function deltaLimits(locators: readonly TimedSlot[], selection: readonly Slot[], durationSec = Infinity): { min: number; max: number } {
  const sorted = [...locators].sort(byTime)
  let min = -Infinity
  let max = Infinity
  sorted.forEach((locator, index) => {
    if (!isSelected(selection, locator)) return
    min = Math.max(min, -locator.timeSec)
    max = Math.min(max, durationSec - locator.timeSec)
    const before = sorted.slice(0, index).findLast((other) => !isSelected(selection, other))
    const after = sorted.slice(index + 1).find((other) => !isSelected(selection, other))
    if (before !== undefined) min = Math.max(min, before.timeSec + MIN_GAP_SEC - locator.timeSec)
    if (after !== undefined) max = Math.min(max, after.timeSec - MIN_GAP_SEC - locator.timeSec)
  })
  return { min: Math.min(0, min), max: Math.max(0, max) }
}

const placedOf = (doc: EditorDoc): TimedSlot[] => doc.timing.locators.map(({ bar, passIndex, timeSec }) => ({ bar, passIndex, timeSec }))

/** The moves one by one, the ones in front of the move's direction first, so none lands on a locator that has not moved yet. */
function applyMoves(doc: EditorDoc, moves: readonly TimedSlot[], later: boolean): EditResult {
  const ordered = [...moves].sort(byTime)
  if (later) ordered.reverse()
  let current = doc
  for (const { bar, passIndex, timeSec } of ordered) {
    const step = dragLocator(current, bar, passIndex, timeSec)
    if (!step.ok) return step
    current = step.doc
  }
  return done(current, { kind: 'move-locators', count: moves.length })
}

/**
 * Moves the selected locators by one offset, as one step. The offset is cut short where a locator would meet one that is
 * not selected; an offset that leaves no room refuses.
 */
export function moveLocators(doc: EditorDoc, selection: readonly Slot[], deltaSec: number, durationSec = Infinity): EditResult {
  const placed = placedOf(doc)
  const present = placed.filter((locator) => isSelected(selection, locator))
  if (present.length === 0) return refuse('not-found')
  const { min, max } = deltaLimits(placed, present, durationSec)
  const delta = Math.min(max, Math.max(min, deltaSec))
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return refuse('out-of-range')
  return applyMoves(doc, present.map((locator) => ({ ...locator, timeSec: locator.timeSec + delta })), delta > 0)
}

/** What a Snap of the selection would do: each locator that can goes to its own beat; `skipped` have no beat that way or would cross a neighbour. */
export interface SnapPlan { moves: TimedSlot[]; skipped: number }

/**
 * Snap to closest goes both ways, so it is decided in time order: a line is held by the final place of the line before it,
 * and by where the line after it is now and is about to be. Moves applied in time order then never meet. A line already
 * on its beat is neither moved nor skipped.
 */
function planClosest(sorted: readonly TimedSlot[], selection: readonly Slot[], beats: readonly DetectedBeat[], durationSec: number): SnapPlan {
  const targets = sorted.map((locator) => (isSelected(selection, locator) ? snapToBeat(locator.timeSec, beats, 'closest') : null))
  const finals = sorted.map((locator) => locator.timeSec)
  const moves: TimedSlot[] = []
  let skipped = 0
  sorted.forEach((locator, index) => {
    if (!isSelected(selection, locator)) return
    const timeSec = targets[index]
    if (timeSec === null) {
      if (nearestBeat(locator.timeSec, beats, CLOSEST_SNAP_SEC) === null) skipped += 1
      return
    }
    const before = finals[index - 1] ?? -Infinity
    const next = sorted[index + 1]
    const after = next === undefined ? Infinity : Math.min(next.timeSec, targets[index + 1] ?? Infinity)
    if (timeSec < before + MIN_GAP_SEC || timeSec > after - MIN_GAP_SEC || timeSec > durationSec) {
      skipped += 1
      return
    }
    finals[index] = timeSec
    moves.push({ bar: locator.bar, passIndex: locator.passIndex, timeSec })
  })
  return { moves, skipped }
}

export function planSnap(locators: readonly TimedSlot[], selection: readonly Slot[], beats: readonly DetectedBeat[], direction: SnapDirection, durationSec = Infinity): SnapPlan {
  const sorted = [...locators].sort(byTime)
  if (direction === 'closest') return planClosest(sorted, selection, beats, durationSec)
  // Where each locator ends up as the plan is made. The ones in front of the direction are decided first, so a locator
  // is held back by the final place of the one ahead of it, whether that one moved or stayed.
  const finals = sorted.map((locator) => locator.timeSec)
  const order = sorted.map((_, index) => index).filter((index) => isSelected(selection, sorted[index]))
  if (direction === 'next') order.reverse()
  const moves: TimedSlot[] = []
  let skipped = 0
  for (const index of order) {
    const timeSec = snapToBeat(sorted[index].timeSec, beats, direction)
    const ahead = finals[index + (direction === 'next' ? 1 : -1)]
    const fits =
      timeSec !== null &&
      (direction === 'next' ? timeSec <= durationSec && (ahead === undefined || timeSec <= ahead - MIN_GAP_SEC) : ahead === undefined || timeSec >= ahead + MIN_GAP_SEC)
    if (!fits) {
      skipped += 1
      continue
    }
    finals[index] = timeSec
    moves.push({ bar: sorted[index].bar, passIndex: sorted[index].passIndex, timeSec })
  }
  return { moves: moves.sort(byTime), skipped }
}

/** The plan of `planSnap` applied as one step; with nothing to move it refuses and changes nothing. */
export function snapLocators(doc: EditorDoc, selection: readonly Slot[], beats: readonly DetectedBeat[], direction: SnapDirection, durationSec = Infinity): { result: EditResult; moved: number; skipped: number } {
  const plan = planSnap(placedOf(doc), selection, beats, direction, durationSec)
  const result = plan.moves.length === 0 ? refuse('out-of-range') : applyMoves(doc, plan.moves, direction === 'next')
  return { result, moved: result.ok ? plan.moves.length : 0, skipped: plan.skipped }
}
