import { gapBetween, hasBoxAfter, hasBoxBefore } from './barLineHits'
import { flagsAfterDelete, flagsAfterInsert, flagsOnBoxes, pageWithFlags } from './boxFlags'
import { type StepLabel } from './history'
import { emptyRunsCannotFit, relabelInPlayOrder, remapLocators } from './locatorRemap'
import { splitListedMarks } from './markRanges'
import { expandPlayOrder } from './playOrder'
import { deleteBarFromTiming, deleteFromRests, insertBarInTiming, insertIntoRests, splitBox, withShortBars } from './renumber'
import { barsInPiece, firstBar, hasPickup, slotFractions, tidyShortBars, validateShortBars } from './shortBars'
import {
  type BarBox,
  type BarNumber,
  type BoxFlag,
  type ClickMode,
  type ListedMark,
  type Locator,
  type MeterChange,
  type PageLayer,
  type PlayOrderRow,
  type ShortBar,
  type TimingLayer,
} from './types'

/** A locator dragged by hand in this visit and not yet resolved: its time and confirmed state before the drag (the "was" line). Session only, never saved. */
export interface MovedLocator { bar: BarNumber; passIndex: number; fromSec: number; wasConfirmed: boolean }

/** A locator the app filled in after a structure edit left its bar without a time (see fillBars.ts). Session only, never saved. */
export interface FilledLocator { bar: BarNumber; passIndex: number }

/** What the editor edits and the history records: the piece's timing and every part's boxes (in part order), the locators moved by hand and the ones filled in. */
export interface EditorDoc {
  timing: TimingLayer
  pages: PageLayer[]
  moved?: readonly MovedLocator[]
  filled?: readonly FilledLocator[]
  /** When the piece's structure was confirmed (the Set the piece structure step); null: not yet. Saved with the map. */
  structureSetAt?: string | null
  /** The recording's length in seconds, when known (view data from the piece, never saved): the play order edit measures the empty slots at the start and the end against it. */
  recordingSec?: number
}

export type EditRefusal =
  | 'no-box' // the part has no box for that bar
  | 'in-multi-rest' // Add bar line inside a box that holds several bars
  | 'too-narrow' // a split or a move would leave a box narrower than MIN_BOX_WIDTH image pixels
  | 'not-line-start' // moveLineStart: that box has another box before it on its line
  | 'not-line-end' // moveLineEnd: that box has another box after it on its line
  | 'line-end' // the line after that bar ends a staff line: it cannot be deleted or moved past its neighbour
  | 'only-bar' // the piece (or the part) has one bar
  | 'invalid' // a structure edit that fails validation (see validateMeters / validatePlayOrder / validateMarks)
  | 'no-free-slot' // a locator edit: no bar between the neighbouring locators is free (see addLocator)
  | 'out-of-range' // a locator edit: the time or the label is not allowed (see moveLocator / relabelLocator)
  | 'duplicate-time' // a locator edit: another locator already sits at that time
  | 'not-found' // a locator edit: no such locator
  | 'moved' // Sounds right on a locator that was dragged: Resolved is the way to check it
  | 'no-piece-pickup' // a part pickup fix: the piece has no pickup bar (bar 0)
  | 'part-has-pickup' // a part pickup fix: the part has a box 0 already
  | 'pickup-edge' // an unnumbered pickup cannot be the first bar (that is the top pickup) or the last (no numbered bar follows)
  | 'already-pickup' // the bar is an unnumbered pickup already
  | 'already-in-order' // relabel in play order: every locator already sits on its slot
  | 'next-to-pickup' // the bar is next to an unnumbered pickup: both would read the same label

/** An ok result carries a new doc; layers the edit did not change keep their reference. */
export type EditResult =
  | { ok: true; doc: EditorDoc; label: StepLabel; droppedLocators: Locator[] }
  | { ok: false; reason: EditRefusal }

export const MIN_BOX_WIDTH = 12

const METER_DENOMINATORS = [1, 2, 4, 8, 16, 32]
const MAX_METER_NUMERATOR = 32

/** The number of boxes in a part; boxes are numbered 1..count without gaps, from 0 when the piece has a pickup. */
export function partBarCount(page: PageLayer): number {
  return page.bars.length
}

export function refuse(reason: EditRefusal): EditResult {
  return { ok: false, reason }
}

export function done(doc: EditorDoc, label: StepLabel, droppedLocators: Locator[] = []): EditResult {
  return { ok: true, doc, label, droppedLocators }
}

function isBarNumber(value: number, barCount: number, first: BarNumber = 1): boolean {
  return Number.isInteger(value) && value >= first && value <= barCount
}

function boxOfBar(page: PageLayer, bar: BarNumber): BarBox | undefined {
  return page.bars.find((box) => box.bar === bar)
}

/**
 * The doc with one part's layer swapped (its boxes, and its rests and box-check flags when given); every other layer keeps
 * its reference. A flag whose bar has no box any more is dropped.
 * A rest after the part's last bar (its last box, or the piece's last bar when the part is short) is dropped: a bar-line
 * edit can push one there, and the map would not be valid (Los Banditos tubas, 2026-11-03).
 */
export function withPage(
  doc: EditorDoc,
  index: number,
  bars: BarBox[],
  rests: BarNumber[] = doc.pages[index].rests,
  flags: readonly BoxFlag[] | undefined = doc.pages[index].boxFlags,
): EditorDoc {
  const last = Math.max(doc.timing.barCount, ...bars.map((box) => box.bar))
  const page = pageWithFlags({ partId: doc.pages[index].partId, bars, rests: rests.filter((bar) => bar <= last) }, flagsOnBoxes(flags, bars))
  return { ...doc, pages: doc.pages.map((existing, i) => (i === index ? page : existing)) }
}

/**
 * The doc with a new timing layer; the pages keep their reference. A moved or filled locator follows its time to its new
 * label (a ripple edit renumbers it) and leaves the list when the edit removed it.
 */
export function withTiming(doc: EditorDoc, timing: TimingLayer): EditorDoc {
  if (doc.moved === undefined && doc.filled === undefined) return { ...doc, timing }
  const follow = <T extends FilledLocator>(entries: readonly T[]): T[] =>
    entries.flatMap((entry) => {
      const old = doc.timing.locators.find((l) => l.bar === entry.bar && l.passIndex === entry.passIndex)
      const now = old === undefined ? undefined : timing.locators.find((l) => l.timeSec === old.timeSec)
      return now === undefined ? [] : [{ ...entry, bar: now.bar, passIndex: now.passIndex }]
    })
  return {
    ...doc,
    timing,
    ...(doc.moved === undefined ? {} : { moved: follow(doc.moved) }),
    ...(doc.filled === undefined ? {} : { filled: follow(doc.filled) }),
  }
}

/**
 * Where the locator that sat on `slot` in `before` sits in `after`, found by its time (which an edit that renumbers does
 * not change); null when it is gone. For view state keyed by (bar, pass), such as a selection, after a play-order edit.
 */
export function slotAfterEdit(before: EditorDoc, after: EditorDoc, slot: { bar: BarNumber; passIndex: number }): { bar: BarNumber; passIndex: number } | null {
  const old = before.timing.locators.find((l) => l.bar === slot.bar && l.passIndex === slot.passIndex)
  const now = old === undefined ? undefined : after.timing.locators.find((l) => l.timeSec === old.timeSec)
  return now === undefined ? null : { bar: now.bar, passIndex: now.passIndex }
}

/** A bar line that ends a staff line: the next box is on another line or page, or there is no next box. */
function endsLine(box: BarBox, next: BarBox | undefined): boolean {
  return next === undefined || next.pageIndex !== box.pageIndex || !(box.y < next.y + next.h && next.y < box.y + box.h)
}

/** The part and the two boxes either side of the bar line after `bar`, or the reason that line cannot be edited. */
function lineAfter(
  doc: EditorDoc,
  partId: string,
  bar: BarNumber,
): { index: number; left: BarBox; right: BarBox } | EditRefusal {
  const index = doc.pages.findIndex((page) => page.partId === partId)
  const left = index === -1 ? undefined : boxOfBar(doc.pages[index], bar)
  if (left === undefined) return 'no-box'
  if (partBarCount(doc.pages[index]) === 1) return 'only-bar'
  const right = boxOfBar(doc.pages[index], bar + 1)
  if (right === undefined || endsLine(left, right)) return 'line-end'
  return { index, left, right }
}

/** Splits bar `bar`'s box of part `partId` at page x; this part's later boxes and rests renumber +1. The timing and the other parts are untouched. */
export function addBarLine(doc: EditorDoc, partId: string, bar: BarNumber, x: number): EditResult {
  const index = doc.pages.findIndex((page) => page.partId === partId)
  const box = index === -1 ? undefined : boxOfBar(doc.pages[index], bar)
  if (box === undefined) return refuse('no-box')
  if (!(x >= box.x + MIN_BOX_WIDTH && x <= box.x + box.w - MIN_BOX_WIDTH)) return refuse('too-narrow')
  const { left, right } = splitBox(box, x)
  const bars = doc.pages[index].bars.flatMap((existing) => {
    if (existing.bar === bar) return [left, { ...right, bar: bar + 1 }]
    return [existing.bar > bar ? { ...existing, bar: existing.bar + 1 } : existing]
  })
  const page = doc.pages[index]
  return done(withPage(doc, index, bars, insertIntoRests(page.rests, bar + 1), flagsAfterInsert(page.boxFlags, bar + 1)), { kind: 'add-bar-line', bar })
}

/** Deletes the bar line after bar `bar` of part `partId` (merging bar and bar+1); this part's later boxes and rests renumber −1. */
export function deleteBarLine(doc: EditorDoc, partId: string, bar: BarNumber): EditResult {
  const line = lineAfter(doc, partId, bar)
  if (typeof line === 'string') return refuse(line)
  const { index, left, right } = line
  const x = Math.min(left.x, right.x)
  const y = Math.min(left.y, right.y)
  const merged: BarBox = {
    ...left,
    x,
    y,
    w: Math.max(left.x + left.w, right.x + right.w) - x,
    h: Math.max(left.y + left.h, right.y + right.h) - y,
  }
  const bars = doc.pages[index].bars.flatMap((existing) => {
    if (existing.bar === bar) return [merged]
    if (existing.bar === bar + 1) return []
    return [existing.bar > bar + 1 ? { ...existing, bar: existing.bar - 1 } : existing]
  })
  const page = doc.pages[index]
  return done(withPage(doc, index, bars, deleteFromRests(page.rests, bar + 1), flagsAfterDelete(page.boxFlags, bar + 1)), { kind: 'delete-bar-line', bar })
}

/**
 * Moves the bar line after bar `bar` to page x: bar's right edge, and bar+1's left edge (same line) to x plus the gap
 * between the two (0 for touching boxes; a bar that starts after a signature keeps the signature's room). Never renumbers.
 */
export function moveBarLine(doc: EditorDoc, partId: string, bar: BarNumber, x: number): EditResult {
  const line = lineAfter(doc, partId, bar)
  if (typeof line === 'string') return refuse(line === 'only-bar' ? 'line-end' : line)
  const { index, left, right } = line
  const gap = gapBetween(left, right) ?? 0
  if (!(x >= left.x + MIN_BOX_WIDTH && x + gap <= right.x + right.w - MIN_BOX_WIDTH)) return refuse('too-narrow')
  const movedLeft: BarBox = { ...left, w: x - left.x }
  const movedRight: BarBox = { ...right, x: x + gap, w: right.x + right.w - x - gap }
  const bars = doc.pages[index].bars.map((existing) =>
    existing.bar === bar ? movedLeft : existing.bar === bar + 1 ? movedRight : existing,
  )
  return done(withPage(doc, index, bars), { kind: 'move-bar-line', bar })
}

/**
 * Moves the left edge of the first box of a line (where the box starts after the clef, key and time signature) to page
 * x, keeping its right edge. The boxes of a multi-rest share one place and move together. Never renumbers.
 */
export function moveLineStart(doc: EditorDoc, partId: string, bar: BarNumber, x: number): EditResult {
  const index = doc.pages.findIndex((page) => page.partId === partId)
  const box = index === -1 ? undefined : boxOfBar(doc.pages[index], bar)
  if (box === undefined) return refuse('no-box')
  const bars = doc.pages[index].bars
  if (hasBoxBefore(bars, box)) return refuse('not-line-start')
  if (!(x >= 0 && x <= box.x + box.w - MIN_BOX_WIDTH)) return refuse('too-narrow')
  const samePlace = (other: BarBox) =>
    other.pageIndex === box.pageIndex && other.x === box.x && other.y === box.y && other.w === box.w && other.h === box.h
  const moved = bars.map((existing) => (samePlace(existing) ? { ...existing, x, w: box.x + box.w - x } : existing))
  return done(withPage(doc, index, moved), { kind: 'move-line-start', bar })
}

/**
 * Moves the right edge of the last box of a line (the true end of the line, after the last bar line) to page x, keeping
 * its left edge, so the box can hold to the bar line that ends the bar and not run on into a courtesy signature or
 * stop short of it. `pageWidth`, when given, is the farthest x. The boxes of a multi-rest share one place and move
 * together. Never renumbers; a box keeps its minimum width, so the edge cannot cross the bar line before it.
 */
export function moveLineEnd(doc: EditorDoc, partId: string, bar: BarNumber, x: number, pageWidth?: number): EditResult {
  const index = doc.pages.findIndex((page) => page.partId === partId)
  const box = index === -1 ? undefined : boxOfBar(doc.pages[index], bar)
  if (box === undefined) return refuse('no-box')
  const bars = doc.pages[index].bars
  if (hasBoxAfter(bars, box)) return refuse('not-line-end')
  if (!(x >= box.x + MIN_BOX_WIDTH && (pageWidth === undefined || x <= pageWidth))) return refuse('too-narrow')
  const samePlace = (other: BarBox) =>
    other.pageIndex === box.pageIndex && other.x === box.x && other.y === box.y && other.w === box.w && other.h === box.h
  const moved = bars.map((existing) => (samePlace(existing) ? { ...existing, w: x - box.x } : existing))
  return done(withPage(doc, index, moved), { kind: 'move-line-end', bar })
}

/**
 * Structure: the piece gains bar after+1 (Phase 1 rule on the timing with `mode`), in the piece only: no part's boxes or
 * rests change (a rest follows its own box; Decisions 2026-11-03). 0 = before bar 1.
 */
export function insertPieceBar(doc: EditorDoc, after: BarNumber, mode: ClickMode): EditResult {
  if (!Number.isInteger(after) || after < 0 || after > doc.timing.barCount) return refuse('invalid')
  const edit = insertBarInTiming(doc.timing, after + 1, mode)
  return done(withTiming(doc, edit.timing), { kind: 'insert-piece-bar', bar: after + 1 }, edit.droppedLocators)
}

/** Structure: the piece loses bar `bar` (Phase 1 rule on the timing with `mode`), in the piece only: no part's boxes or rests change. */
export function removePieceBar(doc: EditorDoc, bar: BarNumber, mode: ClickMode): EditResult {
  if (doc.timing.barCount === 1) return refuse('only-bar')
  if (!isBarNumber(bar, doc.timing.barCount)) return refuse('invalid')
  const edit = deleteBarFromTiming(doc.timing, bar, mode)
  return done(withTiming(doc, edit.timing), { kind: 'remove-piece-bar', bar }, edit.droppedLocators)
}

export type StructureError =
  | { field: 'meters'; index: number; problem: 'first-not-bar-1' | 'out-of-range' | 'not-increasing' | 'bad-meter' }
  | { field: 'playOrder'; index: number; problem: 'out-of-range' | 'from-after-to' | 'empty' }
  | { field: 'marks'; index: number; problem: 'out-of-range' | 'duplicate' }

/** A meter is 1-32 over 1, 2, 4, 8, 16 or 32; the first change starts at bar 1 and fromBars strictly increase within the piece. */
export function validateMeters(meters: MeterChange[], barCount: number): StructureError[] {
  const errors: StructureError[] = []
  meters.forEach((change, index) => {
    const meterIsValid =
      Number.isInteger(change.numerator) &&
      change.numerator >= 1 &&
      change.numerator <= MAX_METER_NUMERATOR &&
      METER_DENOMINATORS.includes(change.denominator)
    if (!meterIsValid) errors.push({ field: 'meters', index, problem: 'bad-meter' })
    if (!isBarNumber(change.fromBar, barCount)) errors.push({ field: 'meters', index, problem: 'out-of-range' })
    else if (index === 0 && change.fromBar !== 1) errors.push({ field: 'meters', index, problem: 'first-not-bar-1' })
    else if (index > 0 && change.fromBar <= meters[index - 1].fromBar) {
      errors.push({ field: 'meters', index, problem: 'not-increasing' })
    }
  })
  return errors
}

/** At least one row; each row has whole numbers with firstBar <= from <= to <= barCount (firstBar is 0 with a pickup). */
export function validatePlayOrder(rows: PlayOrderRow[], barCount: number, firstBar: BarNumber = 1): StructureError[] {
  if (rows.length === 0) return [{ field: 'playOrder', index: 0, problem: 'empty' }]
  const errors: StructureError[] = []
  rows.forEach((row, index) => {
    if (!isBarNumber(row.from, barCount, firstBar) || !isBarNumber(row.to, barCount, firstBar)) {
      errors.push({ field: 'playOrder', index, problem: 'out-of-range' })
    } else if (row.from > row.to) {
      errors.push({ field: 'playOrder', index, problem: 'from-after-to' })
    }
  })
  return errors
}

/**
 * The last bar a part may rest on: the piece's last bar, or the last box of the part when its score has more (a bar line
 * added on that part alone renumbers its boxes and rests, not the shared timing; the processor allows the same).
 */
export function lastRestBar(timing: TimingLayer, page: PageLayer | undefined): BarNumber {
  return Math.max(timing.barCount, ...(page?.bars ?? []).map((box) => box.bar))
}

/**
 * Every mark sits on a bar of the piece (a rest, on a bar of its part: `restLast`, the piece's last bar when not given);
 * a bar carries each kind of mark once. Rests are listed with the marks.
 */
export function validateMarks(marks: ListedMark[], barCount: number, firstBar: BarNumber = 1, restLast: BarNumber = barCount): StructureError[] {
  const errors: StructureError[] = []
  const seen = new Set<string>()
  marks.forEach((mark, index) => {
    if (!isBarNumber(mark.bar, mark.kind === 'rest' ? restLast : barCount, firstBar)) {
      errors.push({ field: 'marks', index, problem: 'out-of-range' })
      return
    }
    const key = `${mark.bar}:${mark.kind}`
    if (seen.has(key)) errors.push({ field: 'marks', index, problem: 'duplicate' })
    seen.add(key)
  })
  return errors
}

export function setMeters(doc: EditorDoc, meters: MeterChange[]): EditResult {
  if (validateMeters(meters, doc.timing.barCount).length > 0) return refuse('invalid')
  const timing = { ...doc.timing, meters: meters.map((change) => ({ ...change })) }
  return done(withTiming(doc, timing), { kind: 'edit-meters' })
}

/**
 * Lays the locators onto the new play order by what they are, not by their old (bar, pass) key (see remapLocators): a bar
 * played once more earlier renames the later passes of it, and nothing is lost for that. Only a locator that has no slot
 * left is dropped. Times never change; a slot the order adds has no time until the fill or the realign gives it one.
 *
 * The times are right and the labels are off (Mozart, 2026-11-06) when some of those slots cannot fit between their
 * neighbours' times (see emptyRunsCannotFit), or when locators would be dropped while slots stay empty: the recording has
 * them, so nothing is surplus. The locators then take the slots by their times instead (relabelInPlayOrder), in the same
 * step, unless that would leave surplus locators to drop (the two cases cannot be told apart safely then).
 * The label of such a step carries `count`, the locators that took a new label, for the status line.
 */
export function setPlayOrder(doc: EditorDoc, rows: PlayOrderRow[]): EditResult {
  if (validatePlayOrder(rows, doc.timing.barCount, firstBar(doc.timing)).length > 0) return refuse('invalid')
  const playOrder = rows.map((row) => ({ ...row }))
  const slots = expandPlayOrder(playOrder, doc.timing.barCount)
  const { kept, dropped } = remapLocators(slots, doc.timing.locators)
  const leftEmpty = slots.length > kept.length
  if ((dropped.length > 0 && leftEmpty) || emptyRunsCannotFit(slots, doc.timing.locators, kept, doc.recordingSec, slotFractions(slots, doc.timing))) {
    const relabelled = relabelInPlayOrder({ ...doc, timing: { ...doc.timing, playOrder } })
    if (relabelled.ok && relabelled.droppedLocators.length === 0 && relabelled.label.count !== undefined && relabelled.label.count > 0) {
      return done(relabelled.doc, { kind: 'edit-play-order', count: relabelled.label.count })
    }
  }
  return done(withTiming(doc, { ...doc.timing, playOrder, locators: kept }), { kind: 'edit-play-order' }, dropped)
}

/**
 * Structure: the bars that are shorter than their meter (the pickup, bar 0, included). The pickup itself is not added or
 * removed here (that renumbers the piece: see pickup.ts); its length can change. Times stay where they are.
 */
export function setShortBars(doc: EditorDoc, shortBars: ShortBar[]): EditResult {
  const timing = doc.timing
  if (validateShortBars(shortBars, timing.meters, timing.barCount).length > 0) return refuse('invalid')
  if (shortBars.some((short) => short.bar === 0) !== hasPickup(timing)) return refuse('invalid')
  return done(withTiming(doc, withShortBars(timing, tidyShortBars(shortBars))), { kind: 'edit-short-bars' })
}

/**
 * Structure > Marks of the part open in the editor (`partId`): fermata and rit. replace the timing's marks, shared by
 * every part; the rests replace that part's rests only. One step. A layer or a timing the edit leaves as it is keeps its reference.
 */
export function setMarks(doc: EditorDoc, marks: ListedMark[], partId: string): EditResult {
  const index = doc.pages.findIndex((page) => page.partId === partId)
  if (index === -1) return refuse('invalid')
  const restLast = lastRestBar(doc.timing, doc.pages[index])
  if (validateMarks(marks, doc.timing.barCount, firstBar(doc.timing), restLast).length > 0) return refuse('invalid')
  const split = splitListedMarks(marks)
  const timing = { ...doc.timing, marks: split.marks }
  const edited = withTiming(doc, timing)
  const same = JSON.stringify(split.rests) === JSON.stringify(doc.pages[index].rests)
  return done(same ? edited : withPage(edited, index, doc.pages[index].bars, split.rests), { kind: 'edit-marks' })
}

/** Problems of one part that the editor shows before the Review Queue exists (Phase 6 adds the timing flags). */
export type PartProblem = { kind: 'bar-count'; partBars: number; pieceBars: number }

export function partProblems(doc: EditorDoc, partId: string): PartProblem[] {
  const page = doc.pages.find((existing) => existing.partId === partId)
  const partBars = page === undefined ? 0 : partBarCount(page)
  const pieceBars = barsInPiece(doc.timing)
  return partBars === pieceBars ? [] : [{ kind: 'bar-count', partBars, pieceBars }]
}

/**
 * Whether a part's bars differ from the piece's, so that Structure > This part > Bars still has something to fix: another
 * number of bars (`partProblems`), or a piece with a pickup whose box the part lacks (the counts can then match by accident).
 */
export function partBarsDiffer(doc: EditorDoc, partId: string): boolean {
  if (partProblems(doc, partId).length > 0) return true
  const page = doc.pages.find((existing) => existing.partId === partId)
  return page !== undefined && hasPickup(doc.timing) && !page.bars.some((box) => box.bar === 0)
}
