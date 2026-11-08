import { expandPlayOrder } from './playOrder'
import { pickupBars, slotUnits } from './shortBars'
import {
  type BarBox,
  type BarNumber,
  type CountInBars,
  type ListedMark,
  type Meter,
  type MeterChange,
  type PageLayer,
  type PlaySlot,
  type TimingLayer,
} from './types'

/** One played bar placed on the recording: where it starts and ends, and whether the time is an estimate. */
export interface SlotTiming {
  slot: PlaySlot
  startSec: number
  endSec: number
  interpolated: boolean
  meter: Meter
  /** How many notes of the meter's denominator the bar holds when it is shorter than its meter (a pickup, an incomplete bar). */
  units?: number
  /** A pickup: it completes the bar played before it and leads into the next, so its first beat is no downbeat and its count-in bar is that whole bar. */
  pickup?: true
}

/** Where the cursor sits on the score page: the slot being played, how far through it, and the page and x it maps to. */
export interface CursorPosition {
  position: number
  bar: BarNumber
  passIndex: number
  fraction: number
  pageIndex: number
  x: number
  box: BarBox
}

/** The tempo of one bar; secPerWhole is the number to compare across meters. */
export interface LocalTempo { beats: number; beatSec: number; bpm: number; secPerWhole: number }

/** The playback speeds the player offers, as a slider's range: any speed from a quarter to double in steps of 0.05; 1 is the recording as recorded. */
export const SPEED_RANGE = { min: 0.25, max: 2, step: 0.05 } as const

/** A speed snapped to the nearest 0.05 (no float noise: 0.85 stays 0.85); null when it is not a number or outside the range. */
export function snapSpeed(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const snapped = Math.round(value / SPEED_RANGE.step) / (1 / SPEED_RANGE.step)
  return snapped >= SPEED_RANGE.min && snapped <= SPEED_RANGE.max ? snapped : null
}

/** The count-in lengths the player offers: 0 = Off, else that many bars. */
export const COUNT_IN_BAR_CHOICES: readonly CountInBars[] = [0, 1, 2, 3, 4]

/** The count-in length a new piece starts with. */
export const DEFAULT_COUNT_IN_BARS: CountInBars = 1

/** A pre-roll replays the recorded bars before the loop with a visual count; a click plays clicks; off plays nothing. */
export type CountInType = 'pre-roll' | 'click' | 'off'

/** Which bar sets the click count-in tempo: the loop's first bar, or the bar before it. */
export type CountInTempoSource = 'loop-first-bar' | 'bar-before'

/** One count-in bar: how many counts, and the wall-clock seconds per count. */
export interface CountInBar { beats: number; beatWallSec: number }

/** What to play before a loop starts; the wall-clock fields are seconds on the clock, so they follow the speed. */
export interface CountInPlan {
  type: CountInType
  /** Total counts over all count-in bars; 0 when off. */
  beats: number
  /** Seconds per count of the first count-in bar; 0 when off. */
  beatWallSec: number
  /** 60 / beatWallSec; 0 when off. */
  bpmWall: number
  recordingStartSec: number
  /** One entry per bar counted in play order, so a pre-roll has one per bar it replays (a pickup and the bar before it are two); empty when off. */
  bars: CountInBar[]
}

function assertMeters(meters: MeterChange[]): void {
  if (meters.length === 0) {
    throw new RangeError('a timing layer needs at least one meter change, starting at bar 1')
  }
  for (const { numerator, denominator } of meters) {
    if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator < 1 || denominator < 1) {
      throw new RangeError(`meter ${numerator}/${denominator} must use whole numbers of at least 1`)
    }
  }
}

/** The meter in force at a bar: the last change at or before it, or the first change for earlier bars. */
function meterInForce(sortedMeters: MeterChange[], bar: BarNumber): Meter {
  let found = sortedMeters[0]
  for (const change of sortedMeters) {
    if (change.fromBar > bar) break
    found = change
  }
  return { numerator: found.numerator, denominator: found.denominator }
}

/** The beats a slot holds: the meter's numerator, or fewer in a short bar. */
function beatsOf(meter: Meter, units: number | undefined): number {
  return units ?? meter.numerator
}

function wholeNotes(meter: Meter, units?: number): number {
  return beatsOf(meter, units) / meter.denominator
}

/** Places every played bar on the recording from the locators; [] with fewer than two located slots. */
export function buildTimeline(timing: TimingLayer, recordingEndSec?: number): SlotTiming[] {
  const slots = expandPlayOrder(timing.playOrder, timing.barCount)
  const positionOf = new Map<string, number>()
  for (const slot of slots) positionOf.set(`${slot.bar}:${slot.passIndex}`, slot.position)

  const locatedTime = new Map<number, number>()
  for (const locator of timing.locators) {
    const position = positionOf.get(`${locator.bar}:${locator.passIndex}`)
    if (position !== undefined && !locatedTime.has(position)) locatedTime.set(position, locator.timeSec)
  }
  const anchors = [...locatedTime.keys()].sort((a, b) => a - b)
  if (anchors.length < 2) return []
  const anchorTimes = anchors.map((position) => locatedTime.get(position) as number)

  const sortedMeters = [...timing.meters].sort((a, b) => a.fromBar - b.fromBar)
  assertMeters(sortedMeters)
  const meters = slots.map((slot) => meterInForce(sortedMeters, slot.bar))
  const unitsOf = slotUnits(slots, timing)
  const pickups = pickupBars(timing)
  const lengths = meters.map((meter, i) => wholeNotes(meter, unitsOf[i]))

  const startSec = new Array<number>(slots.length).fill(0)
  const secPerWholeBetween: number[] = []

  // Between two locators: the slots from the first locator up to (not including) the next share the time in
  // proportion to their whole-note length.
  for (let k = 0; k < anchors.length - 1; k++) {
    const first = anchors[k]
    const next = anchors[k + 1]
    let total = 0
    for (let i = first; i < next; i++) total += lengths[i]
    const span = anchorTimes[k + 1] - anchorTimes[k]
    secPerWholeBetween.push(span / total)
    let before = 0
    for (let i = first; i < next; i++) {
      startSec[i] = anchorTimes[k] + (span * before) / total
      before += lengths[i]
    }
  }

  // Before the first locator: walk backwards at the first located bar's tempo, never earlier than 0.
  let walked = 0
  for (let i = anchors[0] - 1; i >= 0; i--) {
    walked += lengths[i]
    startSec[i] = Math.max(0, anchorTimes[0] - walked * secPerWholeBetween[0])
  }

  // After the last locator: walk forwards at the last measured tempo, never later than the recording end.
  const lastAnchor = anchors[anchors.length - 1]
  const lastSecPerWhole = secPerWholeBetween[secPerWholeBetween.length - 1]
  const lastTime = anchorTimes[anchorTimes.length - 1]
  startSec[lastAnchor] = lastTime
  walked = 0
  for (let i = lastAnchor + 1; i < slots.length; i++) {
    walked += lengths[i - 1]
    const start = lastTime + walked * lastSecPerWhole
    startSec[i] = recordingEndSec === undefined ? start : Math.min(start, recordingEndSec)
  }

  // Each slot ends where the next starts; the last one runs on at the previous bar's tempo.
  const lastIndex = slots.length - 1
  const rawLastEnd = startSec[lastIndex] + lengths[lastIndex] * lastSecPerWhole
  const lastEnd =
    recordingEndSec === undefined ? rawLastEnd : Math.max(startSec[lastIndex], Math.min(rawLastEnd, recordingEndSec))

  return slots.map((slot, i) => ({
    slot,
    startSec: startSec[i],
    endSec: i === lastIndex ? lastEnd : startSec[i + 1],
    interpolated: !locatedTime.has(slot.position),
    meter: meters[i],
    ...(unitsOf[i] === undefined ? {} : { units: unitsOf[i] }),
    ...(pickups.has(slot.bar) ? { pickup: true as const } : {}),
  }))
}

/** Beats, beat length, bpm and seconds per whole note of one bar (beats = the meter's numerator, or the length of a short bar). */
export function localTempo(slot: SlotTiming): LocalTempo {
  const beats = beatsOf(slot.meter, slot.units)
  const duration = slot.endSec - slot.startSec
  const beatSec = duration / beats
  return { beats, beatSec, bpm: 60 / beatSec, secPerWhole: duration / wholeNotes(slot.meter, slot.units) }
}

/** The recording time of each beat of a bar, the first one on its start (for the metronome and the pre-roll count). */
export function beatTimes(slot: SlotTiming): number[] {
  const { beats, beatSec } = localTempo(slot)
  return Array.from({ length: beats }, (_, k) => slot.startSec + k * beatSec)
}

/** The index of the slot that holds a time (start inclusive, end exclusive), or -1 outside the timeline. */
export function slotIndexAt(timeline: SlotTiming[], timeSec: number): number {
  let low = 0
  let high = timeline.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (timeline[middle].startSec <= timeSec) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (found === -1 || timeSec >= timeline[found].endSec) return -1
  return found
}

/** The cursor on the score page at a recording time; null outside the timeline or when the part has no box for the bar. */
export function cursorAt(timeline: SlotTiming[], page: PageLayer, timeSec: number): CursorPosition | null {
  // No speed parameter on purpose: loop points, cursor and page turns all follow recording time (spec 5.5); speed only
  // changes how fast recording time passes on the wall clock.
  const index = slotIndexAt(timeline, timeSec)
  if (index === -1) return null
  const { slot, startSec, endSec } = timeline[index]
  const box = page.bars.find((candidate) => candidate.bar === slot.bar)
  if (box === undefined) return null
  const duration = endSec - startSec
  const fraction = duration > 0 ? (timeSec - startSec) / duration : 0
  return {
    position: slot.position,
    bar: slot.bar,
    passIndex: slot.passIndex,
    fraction,
    pageIndex: box.pageIndex,
    x: box.x + fraction * box.w,
    box,
  }
}

/**
 * Where the `bars` count-in bars before a position start, or null when the play order has not that many. They go by length: a
 * pickup completes the slot played before it, so the two are one bar, and a pickup with nothing before it is no bar at all.
 */
function countInStart(timeline: SlotTiming[], position: number, bars: number): number | null {
  let start = position
  for (let counted = 0; counted < bars; counted++) {
    start -= timeline[start - 1]?.pickup === true ? 2 : 1
    if (start < 0) return null
  }
  return start
}

/**
 * Plans the count-in for a loop that starts at a timeline index: a pre-roll of the bars before the loop, or clicks when
 * those bars are missing or hold a fermata or a rest; nothing when off. `marks` are the fermatas of the timing and the
 * rests of the part being practised (listedMarks): a rest of another part does not stop a pre-roll here. A pickup is never
 * a count-in bar or a tempo of its own: its length comes from the map and its time may be an estimate.
 */
export function planCountIn(
  timeline: SlotTiming[],
  marks: ListedMark[],
  loopStartPosition: number,
  options: { speed: number; tempoSource: CountInTempoSource; bars?: CountInBars },
): CountInPlan {
  const { speed, tempoSource, bars = DEFAULT_COUNT_IN_BARS } = options
  if (timeline.length === 0) throw new RangeError('a count-in needs a timeline with at least one bar')
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError(`speed ${speed} must be above 0`)
  if (!Number.isInteger(loopStartPosition) || loopStartPosition < 0 || loopStartPosition >= timeline.length) {
    throw new RangeError(`loop start ${loopStartPosition} is not a slot of the timeline (0..${timeline.length - 1})`)
  }
  if (!Number.isInteger(bars) || bars < 0 || bars > 4) {
    throw new RangeError(`count-in length ${bars} must be a whole number of bars from 0 to 4`)
  }

  const first = timeline[loopStartPosition]
  if (bars === 0) return { type: 'off', beats: 0, beatWallSec: 0, bpmWall: 0, recordingStartSec: first.startSec, bars: [] }

  // A pre-roll replays the recorded bars before the loop, so each count follows that bar's own meter and tempo (model
  // decision 4). It needs all of them to exist and none to hold a fermata or a rest.
  const preRollStart = countInStart(timeline, loopStartPosition, bars)
  const preRollSlots = preRollStart === null ? [] : timeline.slice(preRollStart, loopStartPosition)
  const preRoll =
    preRollSlots.length > 0 &&
    !preRollSlots.some((played) => marks.some((mark) => mark.bar === played.slot.bar && (mark.kind === 'fermata' || mark.kind === 'rest')))

  if (preRoll) {
    const countBars = preRollSlots.map((played) => {
      const { beats, beatSec } = localTempo(played)
      return { beats, beatWallSec: beatSec / speed }
    })
    const beatWallSec = countBars[0].beatWallSec
    return {
      type: 'pre-roll',
      beats: countBars.reduce((total, bar) => total + bar.beats, 0),
      beatWallSec,
      bpmWall: 60 / beatWallSec,
      recordingStartSec: preRollSlots[0].startSec,
      bars: countBars,
    }
  }

  // A loop on a pickup counts at the pulse of the bar after it, and the count reaches the pickup's place in the bar (6/8 with
  // a one-eighth pickup: five counts, the pickup is the sixth) so it lands on its beat. The toggle's "bar before" is a whole
  // bar too: past a pickup, the bar that pickup completes.
  const onPickup = first.pickup === true && first.units !== undefined && loopStartPosition + 1 < timeline.length
  const beforeStart = countInStart(timeline, loopStartPosition, 1)
  const source =
    tempoSource === 'bar-before' && beforeStart !== null ? timeline[beforeStart] : onPickup ? timeline[loopStartPosition + 1] : first
  const beatWallSec = localTempo(source).secPerWhole / first.meter.denominator / speed
  const rest = onPickup ? first.meter.numerator - (first.units as number) : first.meter.numerator
  const counts = Array.from({ length: bars }, (_, i) => (i === bars - 1 ? rest : first.meter.numerator))
  return {
    type: 'click',
    beats: counts.reduce((total, count) => total + count, 0),
    beatWallSec,
    bpmWall: 60 / beatWallSec,
    recordingStartSec: first.startSec,
    bars: counts.map((beats) => ({ beats, beatWallSec })),
  }
}
