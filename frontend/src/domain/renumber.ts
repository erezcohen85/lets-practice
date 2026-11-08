import { flagsAfterDelete, flagsAfterInsert, pageWithFlags } from './boxFlags'
import { expandPlayOrder, slotOf } from './playOrder'
import {
  type BarBox,
  type BarMark,
  type BarNumber,
  type ClickMode,
  type Locator,
  type Meter,
  type MeterChange,
  type PageLayer,
  type PlayOrderRow,
  type PlaySlot,
  type ShortBar,
  type TimingLayer,
} from './types'

export interface BarEdit { timing: TimingLayer; page: PageLayer; droppedLocators: Locator[] }
export type LocatorEdit =
  | { ok: true; timing: TimingLayer; droppedLocators: Locator[] }
  | { ok: false; reason: 'no-free-slot' | 'out-of-range' | 'duplicate-time' | 'not-found' }
export type NewBox = Omit<BarBox, 'bar'>

const DEFAULT_METER: Meter = { numerator: 4, denominator: 4 }

function slotKey(bar: BarNumber, passIndex: number): string {
  return `${bar}:${passIndex}`
}

function cloneTiming(timing: TimingLayer): TimingLayer {
  return {
    barCount: timing.barCount,
    playOrder: timing.playOrder.map((row) => ({ ...row })),
    meters: timing.meters.map((change) => ({ ...change })),
    marks: timing.marks.map((mark) => ({ ...mark })),
    locators: timing.locators.map((locator) => ({ ...locator })),
    ...(timing.shortBars === undefined ? {} : { shortBars: timing.shortBars.map((short) => ({ ...short })) }),
  }
}

/** The short bars after a bar is inserted at n (later ones follow their bars up) or deleted (its own length goes, later ones follow down). */
function insertIntoShortBars(shortBars: ShortBar[], n: BarNumber): ShortBar[] {
  return shortBars.map((short) => ({ ...short, bar: short.bar >= n ? short.bar + 1 : short.bar }))
}

function deleteFromShortBars(shortBars: ShortBar[], n: BarNumber): ShortBar[] {
  return shortBars.filter((short) => short.bar !== n).map((short) => ({ ...short, bar: short.bar > n ? short.bar - 1 : short.bar }))
}

/** `timing` with its short bars replaced; the key is left out when there are none. */
export function withShortBars(timing: TimingLayer, shortBars: ShortBar[] | undefined): TimingLayer {
  const next = { ...timing }
  delete next.shortBars
  return shortBars === undefined || shortBars.length === 0 ? next : { ...next, shortBars }
}

function byBar(a: BarBox, b: BarBox): number {
  return a.bar - b.bar
}

/** Keeps the locators that still have a slot and, walking the slots in order, only those later in time than the one before. */
export function pruneLocators(
  playOrder: PlayOrderRow[],
  barCount: number,
  locators: Locator[],
): { kept: Locator[]; dropped: Locator[] } {
  const positions = new Map(
    expandPlayOrder(playOrder, barCount).map((slot) => [slotKey(slot.bar, slot.passIndex), slot.position]),
  )
  const copies = locators.map((locator) => ({ ...locator }))
  const dropped = new Set<Locator>()
  const placed: { locator: Locator; position: number }[] = []
  for (const locator of copies) {
    const position = positions.get(slotKey(locator.bar, locator.passIndex))
    if (position === undefined) dropped.add(locator)
    else placed.push({ locator, position })
  }
  placed.sort((a, b) => a.position - b.position)
  const kept: Locator[] = []
  let lastTimeSec = Number.NEGATIVE_INFINITY
  for (const { locator } of placed) {
    if (locator.timeSec > lastTimeSec) {
      kept.push(locator)
      lastTimeSec = locator.timeSec
    } else {
      dropped.add(locator)
    }
  }
  return { kept, dropped: copies.filter((locator) => dropped.has(locator)) }
}

/** Ripple insert: every locator on or after the new bar follows its physical bar one number up. */
function shiftLocatorsUp(locators: Locator[], n: BarNumber): Locator[] {
  return locators.map((locator) => ({ ...locator, bar: locator.bar >= n ? locator.bar + 1 : locator.bar }))
}

/** Ripple delete: the locators of the deleted bar leave, those of later bars follow their physical bars one number down. */
function shiftLocatorsDown(locators: Locator[], n: BarNumber): { moved: Locator[]; removed: Locator[] } {
  return {
    moved: locators
      .filter((locator) => locator.bar !== n)
      .map((locator) => ({ ...locator, bar: locator.bar > n ? locator.bar - 1 : locator.bar })),
    removed: locators.filter((locator) => locator.bar === n).map((locator) => ({ ...locator })),
  }
}

/** Moves each located locator by `offset` slots (keeping time and confirmed); a locator moved to no slot is dropped. */
function moveBySlots(
  locators: Locator[],
  slots: PlaySlot[],
  fromPosition: number,
  offset: number,
): { moved: Locator[]; dropped: Locator[] } {
  const positions = new Map(slots.map((slot) => [slotKey(slot.bar, slot.passIndex), slot.position]))
  const moved: Locator[] = []
  const dropped: Locator[] = []
  for (const locator of locators) {
    const position = positions.get(slotKey(locator.bar, locator.passIndex))
    if (position === undefined || position < fromPosition) {
      moved.push({ ...locator })
      continue
    }
    const target = slots[position + offset]
    if (target === undefined) dropped.push({ ...locator })
    else moved.push({ ...locator, bar: target.bar, passIndex: target.passIndex })
  }
  return { moved, dropped }
}

function insertIntoRows(rows: PlayOrderRow[], n: BarNumber): PlayOrderRow[] {
  // The new bar n is the right part of old bar a = n - 1 (or comes before old bar 1), so bar a is played as two numbers.
  const a = n > 1 ? n - 1 : 1
  return rows.map((row) => ({
    from: row.from <= a ? row.from : row.from + 1,
    to: row.to < a ? row.to : row.to + 1,
  }))
}

function deleteFromRows(rows: PlayOrderRow[], n: BarNumber): PlayOrderRow[] {
  return rows
    .map((row) => ({
      from: row.from > n ? row.from - 1 : row.from,
      to: row.to >= n ? row.to - 1 : row.to,
    }))
    .filter((row) => row.to >= row.from)
}

function insertIntoMeters(meters: MeterChange[], n: BarNumber): MeterChange[] {
  // The first change always stays at bar 1, also when the new bar is inserted before it.
  return meters.map((change) => ({
    ...change,
    fromBar: change.fromBar >= n && change.fromBar !== 1 ? change.fromBar + 1 : change.fromBar,
  }))
}

function deleteFromMeters(meters: MeterChange[], n: BarNumber, newBarCount: number): MeterChange[] {
  const nextBarHasOwnChange = meters.some((change) => change.fromBar === n + 1)
  const shifted = meters
    .filter((change) => !(change.fromBar === n && nextBarHasOwnChange))
    .map((change) => ({ ...change, fromBar: change.fromBar > n ? change.fromBar - 1 : change.fromBar }))
    .filter((change) => change.fromBar <= newBarCount)
    .sort((a, b) => a.fromBar - b.fromBar)
  return shifted.filter((change, i) => {
    const before = shifted[i - 1]
    return before === undefined || before.numerator !== change.numerator || before.denominator !== change.denominator
  })
}

function insertIntoMarks(marks: BarMark[], n: BarNumber): BarMark[] {
  return marks.map((mark) => ({ ...mark, bar: mark.bar >= n ? mark.bar + 1 : mark.bar }))
}

function deleteFromMarks(marks: BarMark[], n: BarNumber): BarMark[] {
  return marks
    .filter((mark) => mark.bar !== n)
    .map((mark) => ({ ...mark, bar: mark.bar > n ? mark.bar - 1 : mark.bar }))
}

/** A part's rests after a bar is inserted at n: the rests on or after n follow their bars up. */
export function insertIntoRests(rests: BarNumber[], n: BarNumber): BarNumber[] {
  return rests.map((bar) => (bar >= n ? bar + 1 : bar))
}

/** A part's rests after bar n is deleted: its own rest goes, later ones follow their bars down. */
export function deleteFromRests(rests: BarNumber[], n: BarNumber): BarNumber[] {
  return rests.filter((bar) => bar !== n).map((bar) => (bar > n ? bar - 1 : bar))
}

function onSameLine(a: BarBox, b: BarBox): boolean {
  return a.pageIndex === b.pageIndex && a.y < b.y + b.h && b.y < a.y + a.h
}

function unionBox(a: BarBox, b: BarBox): BarBox {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    ...a,
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}

function deleteFromBoxes(boxes: BarBox[], n: BarNumber): BarBox[] {
  const removed = boxes.find((box) => box.bar === n)
  const neighbourBar = n === 1 ? 2 : n - 1
  const result: BarBox[] = []
  for (const box of boxes) {
    if (box.bar === n) continue
    const merged =
      removed !== undefined && box.bar === neighbourBar && onSameLine(box, removed) ? unionBox(box, removed) : { ...box }
    result.push({ ...merged, bar: merged.bar > n ? merged.bar - 1 : merged.bar })
  }
  return result.sort(byBar)
}

/** The meter in force at a bar: the latest change at or before it (4/4 when the piece has no meter changes). */
export function meterAt(meters: MeterChange[], bar: BarNumber): Meter {
  let chosen: MeterChange | undefined
  for (const change of [...meters].sort((a, b) => a.fromBar - b.fromBar)) {
    if (chosen === undefined || change.fromBar <= bar) chosen = change
  }
  return chosen === undefined
    ? { ...DEFAULT_METER }
    : { numerator: chosen.numerator, denominator: chosen.denominator }
}

/** One entry per play slot (index = slot position): the locator for that slot, or null when it has none. */
export function locatorsBySlot(timing: TimingLayer): (Locator | null)[] {
  const byKey = new Map<string, Locator>()
  for (const locator of timing.locators) {
    const key = slotKey(locator.bar, locator.passIndex)
    if (!byKey.has(key)) byKey.set(key, locator)
  }
  return expandPlayOrder(timing.playOrder, timing.barCount).map(
    (slot) => byKey.get(slotKey(slot.bar, slot.passIndex)) ?? null,
  )
}

/** The play slots that have no locator, in play order. */
export function unmatchedSlots(timing: TimingLayer): PlaySlot[] {
  const located = new Set(timing.locators.map((locator) => slotKey(locator.bar, locator.passIndex)))
  return expandPlayOrder(timing.playOrder, timing.barCount).filter(
    (slot) => !located.has(slotKey(slot.bar, slot.passIndex)),
  )
}

/** Cuts a bar's box in two at x: the left part keeps the bar number, the right part is the box of a bar still to insert. */
export function splitBox(box: BarBox, x: number): { left: BarBox; right: NewBox } {
  if (!(x > box.x && x < box.x + box.w)) {
    throw new RangeError(`x ${x} must lie inside the box (${box.x}..${box.x + box.w})`)
  }
  return {
    left: { ...box, w: x - box.x },
    right: { pageIndex: box.pageIndex, x, y: box.y, w: box.x + box.w - x, h: box.h },
  }
}

export interface TimingEdit { timing: TimingLayer; droppedLocators: Locator[] }

/** The timing half of insertBar: rows, meters, marks renumber; the mode decides what locators do. */
export function insertBarInTiming(timing: TimingLayer, at: BarNumber, mode: ClickMode): TimingEdit {
  if (!Number.isInteger(at) || at < 1 || at > timing.barCount + 1) {
    throw new RangeError(`bar ${at} must be a whole number from 1 to ${timing.barCount + 1}`)
  }
  const barCount = timing.barCount + 1
  const playOrder = insertIntoRows(timing.playOrder, at)
  const locators = mode === 'ripple' ? shiftLocatorsUp(timing.locators, at) : timing.locators
  const { kept, dropped } = pruneLocators(playOrder, barCount, locators)
  return {
    timing: withShortBars(
      {
        barCount,
        playOrder,
        meters: insertIntoMeters(timing.meters, at),
        marks: insertIntoMarks(timing.marks, at),
        locators: kept,
      },
      timing.shortBars && insertIntoShortBars(timing.shortBars, at),
    ),
    droppedLocators: dropped,
  }
}

/** The timing half of deleteBar. */
export function deleteBarFromTiming(timing: TimingLayer, bar: BarNumber, mode: ClickMode): TimingEdit {
  if (!Number.isInteger(bar) || bar < 1 || bar > timing.barCount) {
    throw new RangeError(`bar ${bar} must be a whole number from 1 to ${timing.barCount}`)
  }
  if (timing.barCount === 1) {
    throw new RangeError('the only bar of a piece cannot be deleted')
  }
  const barCount = timing.barCount - 1
  const playOrder = deleteFromRows(timing.playOrder, bar)
  const { moved, removed } =
    mode === 'ripple' ? shiftLocatorsDown(timing.locators, bar) : { moved: timing.locators, removed: [] }
  const { kept, dropped } = pruneLocators(playOrder, barCount, moved)
  return {
    timing: withShortBars(
      {
        barCount,
        playOrder,
        meters: deleteFromMeters(timing.meters, bar, barCount),
        marks: deleteFromMarks(timing.marks, bar),
        locators: kept,
      },
      timing.shortBars && deleteFromShortBars(timing.shortBars, bar),
    ),
    droppedLocators: [...removed, ...dropped],
  }
}

/** Inserts a bar numbered `at`: boxes, play-order rows, meters, marks and the page's rests renumber; the mode decides what locators do. */
export function insertBar(timing: TimingLayer, page: PageLayer, at: BarNumber, box: NewBox, mode: ClickMode): BarEdit {
  const edit = insertBarInTiming(timing, at, mode)
  const shifted = page.bars.map((existing) => ({
    ...existing,
    bar: existing.bar >= at ? existing.bar + 1 : existing.bar,
  }))
  return {
    ...edit,
    page: pageWithFlags(
      { partId: page.partId, bars: [...shifted, { ...box, bar: at }].sort(byBar), rests: insertIntoRests(page.rests, at) },
      flagsAfterInsert(page.boxFlags, at),
    ),
  }
}

/** Deletes bar `bar`: boxes, play-order rows, meters, marks and the page's rests renumber; the mode decides what locators do. */
export function deleteBar(timing: TimingLayer, page: PageLayer, bar: BarNumber, mode: ClickMode): BarEdit {
  const edit = deleteBarFromTiming(timing, bar, mode)
  const next = { partId: page.partId, bars: deleteFromBoxes(page.bars, bar), rests: deleteFromRests(page.rests, bar) }
  return { ...edit, page: pageWithFlags(next, flagsAfterDelete(page.boxFlags, bar)) }
}

/** Adds a confirmed locator at timeSec: plain fills a free slot between its neighbours, ripple takes the slot after the previous one. */
export function addLocator(timing: TimingLayer, timeSec: number, mode: ClickMode): LocatorEdit {
  if (!Number.isFinite(timeSec) || timeSec < 0) return { ok: false, reason: 'out-of-range' }
  if (timing.locators.some((locator) => locator.timeSec === timeSec)) return { ok: false, reason: 'duplicate-time' }

  const slots = expandPlayOrder(timing.playOrder, timing.barCount)
  const bySlot = locatorsBySlot(timing)
  let previous = -1
  let previousTimeSec = Number.NEGATIVE_INFINITY
  let next = slots.length
  let nextTimeSec = Number.POSITIVE_INFINITY
  bySlot.forEach((locator, position) => {
    if (locator === null) return
    if (locator.timeSec < timeSec && locator.timeSec > previousTimeSec) {
      previous = position
      previousTimeSec = locator.timeSec
    } else if (locator.timeSec > timeSec && locator.timeSec < nextTimeSec) {
      next = position
      nextTimeSec = locator.timeSec
    }
  })
  const free =
    mode === 'ripple'
      ? slots[previous + 1]
      : slots.find((slot) => slot.position > previous && slot.position < next && bySlot[slot.position] === null)
  if (free === undefined) return { ok: false, reason: 'no-free-slot' }

  const edited = cloneTiming(timing)
  let dropped: Locator[] = []
  if (mode === 'ripple') {
    const shifted = moveBySlots(edited.locators, slots, free.position, 1)
    edited.locators = shifted.moved
    dropped = shifted.dropped
  }
  const created: Locator = { bar: free.bar, passIndex: free.passIndex, timeSec, confirmed: true }
  const positions = new Map(slots.map((slot) => [slotKey(slot.bar, slot.passIndex), slot.position]))
  const index = edited.locators.findIndex(
    (locator) => (positions.get(slotKey(locator.bar, locator.passIndex)) ?? -1) > free.position,
  )
  edited.locators.splice(index === -1 ? edited.locators.length : index, 0, created)
  return { ok: true, timing: edited, droppedLocators: dropped }
}

/** Removes the locator of (bar, passIndex): plain leaves its slot unmatched, ripple moves every later locator one slot back. */
export function deleteLocator(timing: TimingLayer, bar: BarNumber, passIndex: number, mode: ClickMode): LocatorEdit {
  const index = timing.locators.findIndex((locator) => locator.bar === bar && locator.passIndex === passIndex)
  if (index === -1) return { ok: false, reason: 'not-found' }
  const edited = cloneTiming(timing)
  edited.locators.splice(index, 1)
  if (mode === 'ripple') {
    const slots = expandPlayOrder(timing.playOrder, timing.barCount)
    const removed = slots.find((slot) => slot.bar === bar && slot.passIndex === passIndex)
    if (removed !== undefined) edited.locators = moveBySlots(edited.locators, slots, removed.position + 1, -1).moved
  }
  return { ok: true, timing: edited, droppedLocators: [] }
}

/** Splits bar `bar` at page x: its box keeps the left part and the right part becomes the new bar `bar + 1`. */
export function splitBar(timing: TimingLayer, page: PageLayer, bar: BarNumber, x: number, mode: ClickMode): BarEdit {
  const box = page.bars.find((existing) => existing.bar === bar)
  if (box === undefined) throw new RangeError(`bar ${bar} has no box to split`)
  const { left, right } = splitBox(box, x)
  const bars = page.bars.map((existing) => (existing.bar === bar ? left : existing))
  const narrowed: PageLayer = pageWithFlags({ partId: page.partId, bars, rests: page.rests }, page.boxFlags)
  return insertBar(timing, narrowed, bar + 1, right, mode)
}

/** Every locator of a bar, one per pass, ordered by passIndex (a bar played twice has two chained locators). */
export function chainedLocators(timing: TimingLayer, bar: BarNumber): Locator[] {
  return timing.locators
    .filter((locator) => locator.bar === bar)
    .map((locator) => ({ ...locator }))
    .sort((a, b) => a.passIndex - b.passIndex)
}

/** The timing layer with the locator at `index` replaced by its edited copy; the other locators are untouched. */
function editLocatorAt(
  timing: TimingLayer,
  index: number,
  changes: Pick<Partial<Locator>, 'timeSec' | 'confirmed'>,
): LocatorEdit {
  const edited = cloneTiming(timing)
  edited.locators = edited.locators.map((locator, i) => (i === index ? { ...locator, ...changes } : locator))
  return { ok: true, timing: edited, droppedLocators: [] }
}

/** Drags one locator to timeSec and confirms it; only that pass changes and it must stay strictly between its neighbours in play order. */
export function moveLocator(timing: TimingLayer, bar: BarNumber, passIndex: number, timeSec: number): LocatorEdit {
  const index = timing.locators.findIndex((locator) => locator.bar === bar && locator.passIndex === passIndex)
  const slot = slotOf(expandPlayOrder(timing.playOrder, timing.barCount), bar, passIndex)
  if (index === -1 || slot === undefined) return { ok: false, reason: 'not-found' }
  if (!Number.isFinite(timeSec) || timeSec < 0) return { ok: false, reason: 'out-of-range' }

  const bySlot = locatorsBySlot(timing)
  const before = bySlot.slice(0, slot.position).reverse().find((locator) => locator !== null)
  const after = bySlot.slice(slot.position + 1).find((locator) => locator !== null)
  if (before && timeSec <= before.timeSec) return { ok: false, reason: 'out-of-range' }
  if (after && timeSec >= after.timeSec) return { ok: false, reason: 'out-of-range' }
  return editLocatorAt(timing, index, { timeSec, confirmed: true })
}

/** Confirms one locator ("Sounds right"): confirmed becomes true, the time does not change. */
export function confirmLocator(timing: TimingLayer, bar: BarNumber, passIndex: number): LocatorEdit {
  const index = timing.locators.findIndex((locator) => locator.bar === bar && locator.passIndex === passIndex)
  if (index === -1) return { ok: false, reason: 'not-found' }
  return editLocatorAt(timing, index, { confirmed: true })
}

/**
 * Spec 5.4: the locator of (bar, passIndex) becomes (newBar, newPass) and every later locator shifts by the same number
 * of slots; locators pushed past the last slot, or overwritten when moving back, are dropped.
 */
export function relabelLocator(
  timing: TimingLayer,
  bar: BarNumber,
  passIndex: number,
  newBar: BarNumber,
  newPass: number,
): LocatorEdit {
  const slots = expandPlayOrder(timing.playOrder, timing.barCount)
  const from = slotOf(slots, bar, passIndex)
  if (from === undefined || !timing.locators.some((l) => l.bar === bar && l.passIndex === passIndex)) {
    return { ok: false, reason: 'not-found' }
  }
  const to = slotOf(slots, newBar, newPass)
  if (to === undefined) return { ok: false, reason: 'out-of-range' }

  const offset = to.position - from.position
  const positions = new Map(slots.map((slot) => [slotKey(slot.bar, slot.passIndex), slot.position]))
  // Moving back, the slots from the target up to the old one are taken by the shifted locators.
  const overwritten = (locator: Locator) => {
    const position = positions.get(slotKey(locator.bar, locator.passIndex)) ?? -1
    return offset < 0 && position >= to.position && position < from.position
  }
  const shifted = moveBySlots(timing.locators.filter((l) => !overwritten(l)), slots, from.position, offset)
  const edited = cloneTiming(timing)
  edited.locators = shifted.moved
  return {
    ok: true,
    timing: edited,
    droppedLocators: [...timing.locators.filter(overwritten).map((l) => ({ ...l })), ...shifted.dropped],
  }
}
