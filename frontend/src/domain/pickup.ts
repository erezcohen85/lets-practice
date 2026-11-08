import { boxGroup } from './boxEdits'
import { pageWithFlags, shiftFlags } from './boxFlags'
import { type StepLabel } from './history'
import { done, refuse, setPlayOrder, withTiming, type EditResult, type EditorDoc } from './pieceEdits'
import { withShortBars } from './renumber'
import { DEFAULT_PICKUP_UNITS, hasPickup, tidyShortBars, validateShortBars } from './shortBars'
import { type BarNumber, type MeterChange, type PageLayer, type PlayOrderRow, type ShortBar, type TimingLayer } from './types'

// The Pickup setting of the Structure panel. A pickup (anacrusis) is bar 0 and the first full bar is bar 1, as printed. A
// piece read with its pickup numbered as bar 1 is renumbered in one step: every bar, play-order row, mark, box, rest and locator
// moves one number down (on) or up (off). The recording times do not move.

function movePages(pages: PageLayer[], by: number): PageLayer[] {
  return pages.map((page) =>
    pageWithFlags(
      { partId: page.partId, bars: page.bars.map((box) => ({ ...box, bar: box.bar + by })), rests: page.rests.map((bar) => bar + by) },
      shiftFlags(page.boxFlags, by),
    ),
  )
}

function moveRows(timing: TimingLayer, by: number) {
  return timing.playOrder.map((row) => ({ from: row.from + by, to: row.to + by }))
}

function moveMarks(timing: TimingLayer, by: number) {
  return timing.marks.map((mark) => ({ ...mark, bar: mark.bar + by }))
}

function moveLocators(timing: TimingLayer, by: number) {
  return timing.locators.map((locator) => ({ ...locator, bar: locator.bar + by }))
}

/** The meters after every bar moves by `by`: the first change stays at bar 1; one that lands on it takes over; equal neighbours merge. */
function moveMeters(meters: MeterChange[], by: number): MeterChange[] {
  const sorted = [...meters].sort((a, b) => a.fromBar - b.fromBar)
  const moved = sorted.map((change, i) => ({ ...change, fromBar: i === 0 ? 1 : change.fromBar + by }))
  const kept = moved.filter((change, i) => !(moved[i + 1] !== undefined && moved[i + 1].fromBar <= change.fromBar))
  return kept.filter((change, i) => {
    const before = kept[i - 1]
    return before === undefined || before.numerator !== change.numerator || before.denominator !== change.denominator
  })
}

function moveShortBars(shortBars: ShortBar[] | undefined, by: number, without: BarNumber): ShortBar[] {
  return (shortBars ?? []).filter((short) => short.bar !== without).map((short) => ({ ...short, bar: short.bar + by }))
}

/**
 * Bar 1 becomes the pickup (bar 0), `units` notes of the meter's denominator long; the later bars move one number down.
 * Refused when the piece has a pickup already, has fewer than two bars, or the length is not shorter than the meter.
 */
export function pickupOn(doc: EditorDoc, units: number = DEFAULT_PICKUP_UNITS): EditResult {
  const { timing } = doc
  const shifted = moveMeters(timing.meters, -1)
  const shortBars = [{ bar: 0, units }, ...moveShortBars(timing.shortBars, -1, 1)]
  if (hasPickup(timing) || timing.barCount < 2) return refuse('invalid')
  if (validateShortBars(shortBars, shifted, timing.barCount - 1).length > 0) return refuse('invalid')
  const next = withShortBars(
    {
      barCount: timing.barCount - 1,
      playOrder: moveRows(timing, -1),
      meters: shifted,
      marks: moveMarks(timing, -1),
      locators: moveLocators(timing, -1),
    },
    tidyShortBars(shortBars),
  )
  return done({ ...withTiming(doc, next), pages: movePages(doc.pages, -1) }, { kind: 'toggle-pickup' })
}

/** The pickup (bar 0) becomes bar 1 and every other bar moves one number up; the pickup's length is forgotten. */
export function pickupOff(doc: EditorDoc): EditResult {
  const { timing } = doc
  if (!hasPickup(timing)) return refuse('invalid')
  const next = withShortBars(
    {
      barCount: timing.barCount + 1,
      playOrder: moveRows(timing, 1),
      meters: moveMeters(timing.meters, 1),
      marks: moveMarks(timing, 1),
      locators: moveLocators(timing, 1),
    },
    tidyShortBars(moveShortBars(timing.shortBars, 1, 0)),
  )
  return done({ ...withTiming(doc, next), pages: movePages(doc.pages, 1) }, { kind: 'toggle-pickup' })
}

// Pickups in the middle of the piece. The bar keeps its internal number; marking it only sets `unnumbered` on its short-bar
// entry, so times, boxes, locators and the play order stay where they are and only the labels after it change (barNames.ts).

function shortBarAt(doc: EditorDoc, bar: BarNumber): ShortBar | undefined {
  return (doc.timing.shortBars ?? []).find((short) => short.bar === bar)
}

function withShortList(doc: EditorDoc, shortBars: ShortBar[], label: StepLabel): EditResult {
  const { timing } = doc
  if (validateShortBars(shortBars, timing.meters, timing.barCount).length > 0) return refuse('invalid')
  return done(withTiming(doc, withShortBars(timing, tidyShortBars(shortBars))), label)
}

/**
 * Bar `bar` becomes a short bar with no number of its own: it reads p plus the next number, and the bars after it read one
 * lower. A bar that is short already keeps its length; else it gets `units` (one beat by default). Refused for bar 0 or a bar
 * outside the piece ('invalid'), the first bar and the last ('pickup-edge'), a bar in any part's multi-rest ('in-multi-rest'),
 * a bar that is a pickup ('already-pickup') or sits next to one ('next-to-pickup'), and a length the meter does not allow.
 * The rows that meet there move with it (rowsAroundPickup), keeping the locators' times, in the same step.
 */
export function markPickupBar(doc: EditorDoc, bar: BarNumber, units?: number): EditResult {
  const { timing } = doc
  if (!Number.isInteger(bar) || bar < 1 || bar > timing.barCount) return refuse('invalid')
  if (bar === 1 || bar === timing.barCount) return refuse('pickup-edge')
  if (doc.pages.some((page) => boxGroup(page, bar).length > 1)) return refuse('in-multi-rest')
  const list = timing.shortBars ?? []
  if (shortBarAt(doc, bar)?.unnumbered === true) return refuse('already-pickup')
  if (list.some((short) => short.unnumbered === true && Math.abs(short.bar - bar) === 1)) return refuse('next-to-pickup')
  const length = units ?? shortBarAt(doc, bar)?.units ?? DEFAULT_PICKUP_UNITS
  const label: StepLabel = { kind: 'add-pickup-bar', bar }
  const marked = withShortList(doc, [...list.filter((short) => short.bar !== bar), { bar, units: length, unnumbered: true }], label)
  if (!marked.ok) return marked
  const rows = rowsAroundPickup(timing.playOrder, bar)
  if (rows === timing.playOrder) return marked
  const moved = setPlayOrder(marked.doc, rows)
  if (!moved.ok) return marked
  return done(moved.doc, moved.label.count === undefined ? label : { ...label, count: moved.label.count }, moved.droppedLocators)
}

/**
 * The play order once bar `pickup` is a pickup. A bar split at a repeat leaves the rows on its left half: a repeat that goes
 * back to the pickup still starts one bar early, and the row before it stops short of the half bar or runs on onto the
 * pickup. So when a row starts on the bar before the pickup and another row breaks off there (it ends just before that bar,
 * on it, or on the pickup, and the next row does not go straight on), the one starts on the pickup and the other ends on
 * the bar before it. Any other pickup leaves the rows alone, and the same array comes back.
 */
export function rowsAroundPickup(rows: PlayOrderRow[], pickup: BarNumber): PlayOrderRow[] {
  const halfBar = pickup - 1
  const startsOnHalf = (row: PlayOrderRow) => row.from === halfBar && row.to >= pickup
  const breaksOff = (row: PlayOrderRow, next: PlayOrderRow | undefined) =>
    !startsOnHalf(row) && row.from < pickup && row.to >= halfBar - 1 && row.to <= pickup && next !== undefined && next.from !== row.to + 1
  const breaking = rows.map((row, i) => breaksOff(row, rows[i + 1]))
  if (!rows.some(startsOnHalf) || !breaking.includes(true)) return rows
  return rows.map((row, i) => ({ from: startsOnHalf(row) ? pickup : row.from, to: breaking[i] ? halfBar : row.to }))
}

/** The unnumbered pickup at `bar` is a full, numbered bar again: its short-bar entry goes, and the numbers after it return. 'not-found' for anything else. */
export function unmarkPickupBar(doc: EditorDoc, bar: BarNumber): EditResult {
  if (shortBarAt(doc, bar)?.unnumbered !== true || bar === 0) return refuse('not-found')
  return withShortList(doc, (doc.timing.shortBars ?? []).filter((short) => short.bar !== bar), { kind: 'remove-pickup-bar', bar })
}

/**
 * The Pickup bar switch of the Edit bar lines panel, for the selected bar: a pickup stops being one, and any other bar becomes
 * one. Bar 1 becomes the top pickup, because the first bar of a piece can only be that; with a top pickup there, bar 1 sits
 * next to one. Takes one beat by default; Structure > Bars sets the length.
 */
export function togglePickup(doc: EditorDoc, bar: BarNumber): EditResult {
  if (bar === 0) return pickupOff(doc)
  if (shortBarAt(doc, bar)?.unnumbered === true) return unmarkPickupBar(doc, bar)
  if (bar === 1) return hasPickup(doc.timing) ? refuse('next-to-pickup') : pickupOn(doc)
  return markPickupBar(doc, bar)
}

/** The length of the unnumbered pickup at `bar`, 1 to numerator - 1 beats; 'not-found' when that bar is not one. */
export function setPickupBarUnits(doc: EditorDoc, bar: BarNumber, units: number): EditResult {
  if (shortBarAt(doc, bar)?.unnumbered !== true) return refuse('not-found')
  const list = (doc.timing.shortBars ?? []).map((short) => (short.bar === bar ? { ...short, units } : short))
  return withShortList(doc, list, { kind: 'set-pickup-length', bar })
}
