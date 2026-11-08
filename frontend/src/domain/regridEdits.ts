import { cleanBeats, gridTimes, learnPulse, LEARN_MIN_LINES, type BeatsPerBar } from './beatGrid'
import { type DetectedBeat } from './beats'
import { heardBeats, sameMeter } from './feltBeats'
import { done, refuse, withTiming, type EditorDoc, type EditRefusal, type EditResult } from './pieceEdits'
import { expandPlayOrder } from './playOrder'
import { addLocator, deleteLocator, locatorsBySlot, meterAt, type LocatorEdit } from './renumber'
import { type BarNumber, type Locator, type Meter, type PlaySlot, type TimingLayer } from './types'

// Putting the bar lines of a stretch on the beats the beat tracker found. The grid itself is beatGrid.ts; this module
// decides which lines to add, delete or move, and applies that as one step. A checked line (confirmed: true) never
// changes time and is never deleted; every line placed here is a guess (confirmed: false).

/** A line this close to a target (seconds) counts as being on it: it is left where it is. */
export const GRID_SNAP_SEC = 0.08

/** Slack (seconds) so a distance of GRID_SNAP_SEC, give or take rounding, is within it. */
const EDGE_SEC = 1e-9
const near = (a: number, b: number): boolean => Math.abs(a - b) <= GRID_SNAP_SEC + EDGE_SEC

/**
 * toSec: the end line's time, or the recording's end. fit 'ripple' (Half-time, Double-time, Bar = N, the pulse card):
 * the bar count in the stretch changes and later bars are renumbered by the ripple. fit 'between' (Continue): the bars
 * between the start line and a checked end line keep their count; when the grid gives fewer lines than the slots between,
 * the missing ones are spread evenly before the end line, and grid lines beyond that count are not used; no line after
 * the end line changes. With no end line (toSec = the recording's end), 'between' fills the slots after the start line
 * in play order, as many as the grid gives before the end, and removes the guesses of slots it cannot reach.
 */
export interface RegridStretch { fromSec: number; toSec: number; fit: 'ripple' | 'between' }
export interface RegridPlan { targets: number[]; adds: number[]; deletes: { bar: number; passIndex: number }[]; beatsPerBar: BeatsPerBar }
/**
 * placed: lines put on a beat (added, or given a new time). removed: lines that end with no time (deleted, or taken off a
 * bar the beats do not reach); a guess given a new time is not one. dropped: lines the ripple pushed off the last bar.
 * spread: placed lines that are spread evenly before the end line (fit 'between').
 */
export interface RegridOutcome { result: EditResult; placed: number; removed: number; dropped: number; spread: number }

const slotKey = (bar: BarNumber, passIndex: number): string => `${bar}:${passIndex}`
const keyOf = (locator: Pick<Locator, 'bar' | 'passIndex'>): string => slotKey(locator.bar, locator.passIndex)
const isChecked = (locator: Locator | null | undefined): boolean => locator?.confirmed === true

/** One line to set in `fit: 'between'`: the slot (a play-order position), its time, and whether it is an evenly spread one. */
interface Fill { position: number; timeSec: number; spread: boolean }

/** Everything a regrid works out: the plan, and for 'between' the lines to set and the guesses to remove. */
interface Analysis {
  plan: RegridPlan
  slots: PlaySlot[]
  fills: Fill[]
  removals: Locator[]
  spread: number
}

/**
 * The slot the stretch begins at: the one of the line nearest to `fromSec` within GRID_SNAP_SEC; else the slot after the
 * last line before it (where a line added there would go); else the first.
 */
function startSlot(locators: readonly Locator[], positions: ReadonlyMap<string, number>, fromSec: number): number {
  let nearest: { position: number; distance: number } | undefined
  let before = -1
  for (const locator of locators) {
    const position = positions.get(keyOf(locator))
    if (position === undefined) continue
    const distance = Math.abs(locator.timeSec - fromSec)
    if (near(locator.timeSec, fromSec) && (nearest === undefined || distance < nearest.distance)) nearest = { position, distance }
    else if (locator.timeSec < fromSec) before = Math.max(before, position)
  }
  return nearest?.position ?? before + 1
}

/** The checked line a 'between' stretch ends at: the first checked line after the start slot that sits at `toSec`. */
function endLineOf(bySlot: readonly (Locator | null)[], startPosition: number, toSec: number): { position: number; timeSec: number } | undefined {
  for (let position = startPosition + 1; position < bySlot.length; position++) {
    const locator = bySlot[position]
    if (locator !== null && isChecked(locator) && near(locator.timeSec, toSec)) return { position, timeSec: locator.timeSec }
  }
  return undefined
}

/** The ripple plan: every target without a line near it gets one; a guess inside the stretch with no target near it goes. */
function rippleAnalysis(base: Analysis, timing: TimingLayer, stretch: RegridStretch, targets: readonly number[]): Analysis {
  const deletes = timing.locators
    .filter((l) => l.timeSec > stretch.fromSec && l.timeSec < stretch.toSec && !isChecked(l) && !targets.some((t) => near(t, l.timeSec)))
    .sort((a, b) => a.timeSec - b.timeSec)
    .map(({ bar, passIndex }) => ({ bar, passIndex }))
  const adds = targets.filter((t) => !timing.locators.some((l) => near(l.timeSec, t)))
  return { ...base, plan: { ...base.plan, targets: [...targets], adds, deletes } }
}

/**
 * The 'between' plan. Slot `startPosition + k` takes the k-th target (the start line is the 0th); with an end line there are
 * `room` such slots and missing targets are spread evenly between the last target and the end line. A slot whose line is
 * checked, or within GRID_SNAP_SEC of its target, is left. With no end line the guesses of the slots after the last target
 * (and before toSec) are removed.
 */
function betweenAnalysis(
  base: Analysis,
  bySlot: readonly (Locator | null)[],
  stretch: RegridStretch,
  stepped: readonly number[],
  startPosition: number,
  room: number,
  end: { position: number; timeSec: number } | undefined,
): Analysis {
  if (stepped.length === 0 || room <= 0) return base
  const used = stepped.filter((t, index) => end === undefined || index === 0 || !near(t, end.timeSec)).slice(0, room)
  const candidates: Fill[] = used.map((timeSec, index) => ({ position: startPosition + index, timeSec, spread: false }))
  if (end !== undefined) {
    const missing = room - used.length
    const last = used[used.length - 1]
    for (let step = 1; step <= missing; step++) {
      candidates.push({ position: startPosition + used.length + step - 1, timeSec: last + ((end.timeSec - last) * step) / (missing + 1), spread: true })
    }
  }
  const fills = candidates.filter(({ position, timeSec }) => {
    const existing = bySlot[position]
    return !(isChecked(existing) || (existing != null && near(existing.timeSec, timeSec)))
  })
  const removals =
    end !== undefined
      ? []
      : bySlot.slice(startPosition + used.length).filter((l): l is Locator => l !== null && !isChecked(l) && l.timeSec < stretch.toSec)
  // The guess a bar had before it was given a new time goes from its old place: the preview shows it dimmed beside the new one.
  const replaced = fills.flatMap(({ position }) => bySlot[position] ?? [])
  return {
    ...base,
    plan: {
      ...base.plan,
      targets: candidates.map((c) => c.timeSec),
      adds: fills.map((f) => f.timeSec),
      deletes: [...replaced, ...removals].map(({ bar, passIndex }) => ({ bar, passIndex })),
    },
    fills,
    removals,
    spread: fills.filter((f) => f.spread).length,
  }
}

function analyse(doc: EditorDoc, stretch: RegridStretch, beats: readonly DetectedBeat[], beatsPerBar: BeatsPerBar, offsetSec: number, reference?: Meter): Analysis {
  const { timing } = doc
  const slots = expandPlayOrder(timing.playOrder, timing.barCount)
  const nothing: Analysis = { plan: { targets: [], adds: [], deletes: [], beatsPerBar }, slots, fills: [], removals: [], spread: 0 }
  const grid = cleanBeats(beats.map((beat) => beat.t))
  // Under two beats there is no gap to step by: with no targets every guess in the stretch would look stray, so do nothing.
  if (grid.length < 2) return nothing

  const positions = new Map(slots.map((slot) => [slotKey(slot.bar, slot.passIndex), slot.position]))
  const bySlot = locatorsBySlot(timing)
  const startPosition = startSlot(timing.locators, positions, stretch.fromSec)
  const end = stretch.fit === 'between' ? endLineOf(bySlot, startPosition, stretch.toSec) : undefined
  const endSec = end?.timeSec ?? stretch.toSec
  // The lines the stretch can hold: the bars from the start slot on, up to the end line, or the piece's last bar.
  const room = (end?.position ?? slots.length) - startPosition
  // N counts the beats heard in a bar of the reference meter (the start bar's, unless the caller names one); a bar of another meter,
  // or a short one, takes its share of them. A whole bar of another meter has an exact share, so it is not snapped to a beat.
  const meter = reference ?? meterAt(timing.meters, (slots[startPosition] ?? slots[slots.length - 1])?.bar ?? 1)
  const heard = heardBeats(slots, timing, meter)
  const stepped = gridTimes(grid, stretch.fromSec, endSec, beatsPerBar, heard.shares.slice(startPosition), offsetSec, heard.snaps.slice(startPosition))
  return stretch.fit === 'between'
    ? betweenAnalysis(nothing, bySlot, stretch, stepped, startPosition, room, end)
    : rippleAnalysis(nothing, timing, stretch, stepped.slice(0, Math.max(0, room)))
}

/**
 * What a regrid of the stretch would do: target times from gridTimes (cleanBeats of the beats), N beats a bar being the beats
 * heard in one bar of the reference meter (the meter of the stretch's start bar, unless `reference` names another: Continue
 * names the meter it learned in), so a bar of another meter spans N x its felt beats / the reference's (see heardBeats),
 * and a pickup or split bar its share of that; a guess inside the
 * stretch (strictly between fromSec and toSec) with no target within GRID_SNAP_SEC is deleted; a target with no line
 * within GRID_SNAP_SEC, and not within GRID_SNAP_SEC of a checked line, is added. Checked lines are never in deletes.
 * The targets are the lines of the bars from the start line on, the start line's own time first; there are no more of
 * them than the piece has bars left. With fit 'between' a line to set is an add, and the guess it replaces (the old line of
 * a bar given a new time) is a delete beside the guesses taken off bars the beats do not reach, so the preview can dim
 * every old guess that moves or goes; nothing is renumbered. RegridOutcome.removed counts only the lines that end with no
 * time. No beats, or one: an empty plan.
 */
export function planRegrid(doc: EditorDoc, stretch: RegridStretch, beats: readonly DetectedBeat[], beatsPerBar: BeatsPerBar, offsetSec = 0, reference?: Meter): RegridPlan {
  return analyse(doc, stretch, beats, beatsPerBar, offsetSec, reference).plan
}

/** The same locator with a guess's state: not confirmed, and whatever flags and check it had are gone with its old place. */
function guessAt(slot: Pick<Locator, 'bar' | 'passIndex'>, timeSec: number): Locator {
  return { bar: slot.bar, passIndex: slot.passIndex, timeSec, confirmed: false }
}

/**
 * A guess added the way addLocatorAt does: into a free bar between its neighbours if there is one, else by the ripple.
 * The new line is found by its bar: every bar before the one the edit made room for is as it was, so it is the first bar
 * whose line differs from before (a ripple moved the old line of that bar up).
 */
function addGuess(timing: TimingLayer, timeSec: number): LocatorEdit {
  const plain = addLocator(timing, timeSec, 'plain')
  const edit = plain.ok ? plain : addLocator(timing, timeSec, 'ripple')
  if (!edit.ok) return edit
  const before = locatorsBySlot(timing)
  const after = locatorsBySlot(edit.timing)
  const created = after[after.findIndex((line, position) => line?.timeSec !== before[position]?.timeSec)]
  if (created == null) return { ok: false, reason: 'not-found' }
  const key = keyOf(created)
  return { ...edit, timing: { ...edit.timing, locators: edit.timing.locators.map((l) => (keyOf(l) === key ? { ...l, confirmed: false } : l)) } }
}

function refused(reason: EditRefusal): RegridOutcome {
  return { result: refuse(reason), placed: 0, removed: 0, dropped: 0, spread: 0 }
}

function applyRipple(doc: EditorDoc, plan: RegridPlan): RegridOutcome {
  let timing = doc.timing
  // last to first, so the labels of the lines still to delete have not moved
  for (const { bar, passIndex } of [...plan.deletes].reverse()) {
    const edit = deleteLocator(timing, bar, passIndex, 'ripple')
    if (!edit.ok) return refused(edit.reason)
    timing = edit.timing
  }
  const dropped: Locator[] = []
  let placed = 0
  for (const timeSec of plan.adds) {
    const edit = addGuess(timing, timeSec)
    if (!edit.ok) {
      // no bar is left for this line, nor for any after it; any other refusal skips just this line
      if (edit.reason === 'no-free-slot') break
      continue
    }
    // a checked line is never dropped: an add that would push one off the last bar refuses the whole step
    if (edit.droppedLocators.some((l) => isChecked(l))) return refused('no-free-slot')
    timing = edit.timing
    dropped.push(...edit.droppedLocators)
    placed += 1
  }
  if (placed === 0 && plan.deletes.length === 0) return refused('out-of-range')
  return { result: done(withTiming(doc, timing), { kind: 'regrid' }, dropped), placed, removed: plan.deletes.length, dropped: dropped.length, spread: 0 }
}

function applyBetween(doc: EditorDoc, analysis: Analysis): RegridOutcome {
  const { slots, fills, removals } = analysis
  const positions = new Map(slots.map((slot) => [slotKey(slot.bar, slot.passIndex), slot.position]))
  // a locator that sits on no slot (a map should not have one) goes last, where it is
  const positionOf = (locator: Locator): number => positions.get(keyOf(locator)) ?? slots.length
  const gone = new Set([...removals.map(keyOf), ...fills.map(({ position }) => keyOf(slots[position]))])
  const created = fills.map(({ position, timeSec }) => guessAt(slots[position], timeSec))
  const changed = new Set(created.map(keyOf))
  const locators = [...doc.timing.locators.filter((l) => !gone.has(keyOf(l))), ...created].sort((a, b) => positionOf(a) - positionOf(b))
  // The order of the times must follow the order of the bars wherever a line was set, or a checked line in the stretch is in the way.
  for (let index = 0; index < locators.length; index++) {
    const locator = locators[index]
    if (changed.has(keyOf(locator)) && locator.timeSec < 0) return refused('out-of-range')
    const before = locators[index - 1]
    if (before !== undefined && (changed.has(keyOf(locator)) || changed.has(keyOf(before))) && !(locator.timeSec > before.timeSec)) return refused('out-of-range')
  }
  const timing: TimingLayer = { ...doc.timing, locators }
  return {
    result: done(withTiming(doc, timing), { kind: 'regrid' }),
    placed: fills.length,
    removed: removals.length,
    dropped: 0,
    spread: analysis.spread,
  }
}

/**
 * Applies the plan as one step. fit 'ripple': deletes with deleteLocator(..., 'ripple') from the last to the first, then
 * adds left to right with addLocator(..., 'plain') falling back to 'ripple' (the rule of addLocatorAt in
 * timingEdits.ts). fit 'between': sets the times of the slots between the start and end lines directly (creating or
 * removing their locators) as described on RegridStretch, with no renumbering. Either way every placed locator gets
 * confirmed: false. Label { kind: 'regrid' }. Nothing to do: refuse('out-of-range'). dropped counts the
 * droppedLocators the ripple reported; spread counts the evenly spread lines of 'between'.
 *
 * Two refusals beyond that: a ripple that would push a checked line off the last bar refuses 'no-free-slot'; a 'between'
 * that would put a line out of order with a checked one inside the stretch refuses 'out-of-range'. When the piece runs out
 * of bars while the ripple adds, the lines left over are not placed (placed says how many were).
 */
export function regridLocators(doc: EditorDoc, stretch: RegridStretch, beats: readonly DetectedBeat[], beatsPerBar: BeatsPerBar, offsetSec = 0, reference?: Meter): RegridOutcome {
  const analysis = analyse(doc, stretch, beats, beatsPerBar, offsetSec, reference)
  if (analysis.plan.adds.length === 0 && analysis.plan.deletes.length === 0) return refused('out-of-range')
  return stretch.fit === 'between' ? applyBetween(doc, analysis) : applyRipple(doc, analysis.plan)
}

/**
 * Continue from my bars: see planContinue. firstBar and lastBar are the bars of the lines the pulse was learned from;
 * lastPassIndex is the pass of the last of them, which with lastBar names the run (the slot it ends at); learnedTimes are the
 * times of those lines, so a caller can tell whether one of them has only just been checked.
 * endBar is the bar the plan continues to: the bar of the end line, or with no end line the bar of the last slot the plan
 * reaches. All of them are internal bar numbers; the screen turns them into labels.
 */
export interface ContinuePlan {
  stretch: RegridStretch
  beatsPerBar: BeatsPerBar
  offsetSec: number
  /** The meter of the bars the pulse was learned from: the one beatsPerBar counts in. Pass it to planRegrid and regridLocators. */
  referenceMeter: Meter
  firstBar: number
  lastBar: number
  lastPassIndex: number
  learnedTimes: number[]
  endBar: number
  plan: RegridPlan
}

/**
 * Continue from my bars: the stretch starts at the last line of the latest run of at least LEARN_MIN_LINES checked
 * lines in a row (by play-order slot) that is followed by a guess or a missing line; `from` (a slot) moves that start
 * to the run ending at that slot. The pulse is learned from the bars between the run's last LEARN_MIN_LINES lines (3 bars
 * for 4 lines), and those bars must be of one meter: a run that crosses a meter change counts only its last such bars, and
 * needs LEARN_MIN_LINES lines of them, else there is no plan. The bar the last line starts is not one of them, so its meter
 * does not matter. The meter of those bars is the reference N counts in (referenceMeter), so the bars the plan goes on to
 * (the last line's bar included) take their share by it. The stretch ends at the next checked line,
 * or at durationSec. Learned with learnPulse on the run's last LEARN_MIN_LINES lines (firstBar and lastBar are the bars of
 * those lines). endBar is the bar of the end line, or with no end line the bar of the last slot the plan reaches. Null
 * when there is no such run or learnPulse returns null; planContinueOrWhy says which.
 */
export function planContinue(doc: EditorDoc, beats: readonly DetectedBeat[], durationSec: number, from?: { bar: number; passIndex: number }): ContinuePlan | null {
  return planContinueOrWhy(doc, beats, durationSec, from).plan
}

/**
 * Why Continue has nothing to go on with. 'no-run': no run of LEARN_MIN_LINES checked lines in a row (of one meter) ends at a
 * slot something unchecked follows (or at `from`). 'not-steady': there is a run, but its bars do not hold the same whole number
 * of beats, or a line is more than LEARN_MAX_OFFSET_SEC from a beat, or there are no beats to learn from. 'no-room': the
 * recording ends at or before the run's last line.
 */
export type ContinueOff = 'no-run' | 'not-steady' | 'no-room'

/** planContinue's answer with its reason: the plan and no reason, or no plan and the reason. */
export type ContinueResult = { plan: ContinuePlan; off: null } | { plan: null; off: ContinueOff }

/** planContinue, saying why when it has no plan. */
export function planContinueOrWhy(doc: EditorDoc, beats: readonly DetectedBeat[], durationSec: number, from?: { bar: number; passIndex: number }): ContinueResult {
  const { timing } = doc
  const slots = expandPlayOrder(timing.playOrder, timing.barCount)
  const bySlot = locatorsBySlot(timing)
  const checkedAt = (position: number): boolean => isChecked(bySlot[position])
  const meterAtSlot = (position: number) => meterAt(timing.meters, slots[position].bar)
  // The checked lines in a row that end at `position`, counting the line itself and then the lines before it while their bars (the
  // bars measured between the lines) are in the meter of the bar before `position`: a pulse is learned from bars of one meter only.
  // The bar `position` starts is not measured, so it may be in another meter.
  const checkedRunEndingAt = (position: number): number => {
    if (position === 0) return 1
    const meter = meterAtSlot(position - 1)
    let length = 1
    while (position - length >= 0 && checkedAt(position - length) && sameMeter(meterAtSlot(position - length), meter)) length += 1
    return length
  }
  // a run ends at a checked line that something unchecked, or nothing yet, follows, and holds enough lines of one meter to learn from
  const endsRun = (position: number): boolean =>
    checkedAt(position) && position + 1 < bySlot.length && !checkedAt(position + 1) && checkedRunEndingAt(position) >= LEARN_MIN_LINES

  let end = -1
  if (from === undefined) {
    for (let position = bySlot.length - 1; position >= 0 && end < 0; position--) if (endsRun(position)) end = position
  } else {
    const position = slots.findIndex((slot) => slot.bar === from.bar && slot.passIndex === from.passIndex)
    if (position >= 0 && endsRun(position)) end = position
  }
  if (end < 0) return { plan: null, off: 'no-run' }

  const learnedFrom = bySlot.slice(end - LEARN_MIN_LINES + 1, end + 1).filter((l): l is Locator => l !== null)
  const pulse = learnPulse(cleanBeats(beats.map((beat) => beat.t)), learnedFrom.map((l) => l.timeSec))
  if (pulse === null) return { plan: null, off: 'not-steady' }

  const fromSec = learnedFrom[learnedFrom.length - 1].timeSec
  let toSec = durationSec
  let endLine = -1
  for (let position = end + 1; position < bySlot.length && endLine < 0; position++) {
    const next = bySlot[position]
    if (next !== null && isChecked(next)) {
      toSec = next.timeSec
      endLine = position
    }
  }
  if (!(toSec > fromSec)) return { plan: null, off: 'no-room' }

  const stretch: RegridStretch = { fromSec, toSec, fit: 'between' }
  // the bars between the learned lines are of one meter (the run was counted that way): the bar before the last line names it
  const referenceMeter = meterAtSlot(end - 1)
  const plan = planRegrid(doc, stretch, beats, pulse.beatsPerBar, pulse.offsetSec, referenceMeter)
  // Its targets start with the run's last line, one to a bar from there; with no beats to give any, the plan reaches no further.
  const reached = Math.min(bySlot.length - 1, end + Math.max(0, plan.targets.length - 1))
  return {
    off: null,
    plan: {
      stretch,
      beatsPerBar: pulse.beatsPerBar,
      offsetSec: pulse.offsetSec,
      referenceMeter,
      firstBar: slots[end - LEARN_MIN_LINES + 1].bar,
      lastBar: slots[end].bar,
      lastPassIndex: slots[end].passIndex,
      learnedTimes: learnedFrom.map((l) => l.timeSec),
      endBar: slots[endLine >= 0 ? endLine : reached].bar,
      plan,
    },
  }
}
