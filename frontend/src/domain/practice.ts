import { type BarNames } from './barNames'
import { beatTimes, cursorAt, snapSpeed, type SlotTiming } from './tempo'
import { CLICK_TONES, DEFAULT_PRACTICE_MEMORY, type BarBox, type BarNumber, type PageLayer, type PracticeMemory } from './types'

/** A loop over play-order positions, both ends inclusive. */
export interface LoopRange { startPosition: number; endPosition: number }

/** A metronome click on the recording; accent marks the first beat of a bar. */
export interface Click { timeSec: number; accent: boolean }

/** Where the score should follow the cursor: its bar, the top of that bar's line, and how far through the bar it is. */
export interface FollowTarget { box: BarBox; lineTop: number; pageIndex: number; fraction: number }

/**
 * A media element reads back a seek a hair before the time asked for (102.5499 for 102.55), which would put the cursor in
 * the bar before the one just picked: the bar shown, linked and followed is the one this far ahead.
 */
export const CURSOR_SLACK_SEC = 0.03

/** Boxes whose tops differ by no more than this many page pixels sit on the same line of music. */
const SAME_LINE_PX = 8

/** What the toolbar field accepts: a bar, or two with a hyphen, en dash or em dash between them; each may name its pass. */
const RANGE_PATTERN = /^\s*(p?\d+)\s*(?:\(\s*(\d+)\s*\))?\s*(?:[-–—]\s*(p?\d+)\s*(?:\(\s*(\d+)\s*\))?\s*)?$/i

/** The passes (0-based) in which a bar is played: [0] for a plain bar, [0, 1] inside a repeat. */
export function passesOf(timeline: SlotTiming[], bar: BarNumber): number[] {
  return timeline.filter((played) => played.slot.bar === bar).map((played) => played.slot.passIndex)
}

/** The position of the given pass (0-based) of a bar, or -1. */
export function positionOfPass(timeline: SlotTiming[], bar: BarNumber, passIndex: number): number {
  return timeline.findIndex((played) => played.slot.bar === bar && played.slot.passIndex === passIndex)
}

/** The first slot of a bar at or after a position, or -1. */
function firstAtOrAfter(timeline: SlotTiming[], bar: BarNumber, position: number): number {
  for (let i = position; i < timeline.length; i++) {
    if (timeline[i].slot.bar === bar) return i
  }
  return -1
}

/**
 * The range from `startBar` in pass `startPass` to the first slot of `endBar` at or after it in play order. Taps in
 * either order work: the lower bar number starts (and `startPass` then names its pass). Null when the start pass does not
 * exist or the end bar is not played after the start.
 */
export function rangeFromTaps(timeline: SlotTiming[], startBar: BarNumber, endBar: BarNumber, startPass: number): LoopRange | null {
  const [first, last] = startBar <= endBar ? [startBar, endBar] : [endBar, startBar]
  const startPosition = positionOfPass(timeline, first, startPass)
  if (startPosition === -1) return null
  const endPosition = firstAtOrAfter(timeline, last, startPosition)
  if (endPosition === -1) return null
  return { startPosition, endPosition }
}

/**
 * "13–24", or "13 (2)–24" when the start is a later pass. The end shows its pass too, "13–16 (2)", when it is not the
 * first copy of that bar at or after the start, so the label always names the range it came from.
 */
export function rangeLabel(timeline: SlotTiming[], range: LoopRange, names: BarNames): string {
  const start = timeline[range.startPosition].slot
  const end = timeline[range.endPosition].slot
  const startText = start.passIndex === 0 ? names.label(start.bar) : `${names.label(start.bar)} (${start.passIndex + 1})`
  const endText =
    firstAtOrAfter(timeline, end.bar, range.startPosition) === range.endPosition ? names.label(end.bar) : `${names.label(end.bar)} (${end.passIndex + 1})`
  return `${startText}–${endText}`
}

/** Parses the toolbar field ("13-24", "13–24", "13 (2)-24", "p7-9", or "13" for that bar alone); the bars are labels. An error says why it is not a range of this piece. */
export function parseRange(
  timeline: SlotTiming[],
  text: string,
  names: BarNames,
): { range: LoopRange } | { error: 'format' | 'unknown-bar' | 'order' } {
  const match = RANGE_PATTERN.exec(text)
  if (match === null) return { error: 'format' }
  // One bar alone ends where it starts, in the same pass.
  const alone = match[3] === undefined
  const [startBar, endBar] = [names.parse(match[1]), names.parse(alone ? match[1] : match[3])]
  if (startBar === null || endBar === null) return { error: 'unknown-bar' }
  const startPass = match[2] === undefined ? 0 : Number(match[2]) - 1
  const endPass = alone ? startPass : match[4] === undefined ? undefined : Number(match[4]) - 1

  const startPosition = positionOfPass(timeline, startBar, startPass)
  const endPosition =
    endPass === undefined ? firstAtOrAfter(timeline, endBar, Math.max(startPosition, 0)) : positionOfPass(timeline, endBar, endPass)
  if (startPosition === -1) return { error: 'unknown-bar' }
  if (passesOf(timeline, endBar).length === 0 || (endPass !== undefined && endPosition === -1)) return { error: 'unknown-bar' }
  if (endPosition === -1 || endPosition < startPosition) return { error: 'order' }
  return { range: { startPosition, endPosition } }
}

/** Next loop: the range moves forward by its own length in positions, clamped at the end; null at the end already. */
export function nextLoop(timeline: SlotTiming[], range: LoopRange): LoopRange | null {
  const lastPosition = timeline.length - 1
  if (range.endPosition >= lastPosition) return null
  const length = range.endPosition - range.startPosition + 1
  const startPosition = range.endPosition + 1
  return { startPosition, endPosition: Math.min(startPosition + length - 1, lastPosition) }
}

/** The recording times a loop runs between: the start of its first slot and the end of its last. */
export function loopTimes(timeline: SlotTiming[], range: LoopRange): { startSec: number; endSec: number } {
  return { startSec: timeline[range.startPosition].startSec, endSec: timeline[range.endPosition].endSec }
}

/** How far through the loop the music is, 0 to 1; without a loop, how far through the whole recording. 0 when there is no length to measure against. */
export function playProgress(timeSec: number, loop: { startSec: number; endSec: number } | null, durationSec: number | null): number {
  const startSec = loop?.startSec ?? 0
  const lengthSec = loop === null ? durationSec : loop.endSec - loop.startSec
  if (lengthSec === null || !(lengthSec > 0)) return 0
  return Math.min(1, Math.max(0, (timeSec - startSec) / lengthSec))
}

/** Metronome clicks with recording times in [fromSec, toSec): beats spread evenly inside each bar (beatTimes), the first of each bar accented. */
export function clicksBetween(timeline: SlotTiming[], fromSec: number, toSec: number): Click[] {
  if (!(fromSec < toSec)) return []
  // The first slot that ends after the window opens; slots are in time order.
  let low = 0
  let high = timeline.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (timeline[middle].endSec > fromSec) high = middle
    else low = middle + 1
  }
  const clicks: Click[] = []
  for (let i = low; i < timeline.length && timeline[i].startSec < toSec; i++) {
    beatTimes(timeline[i]).forEach((timeSec, beat) => {
      // a pickup leads into the downbeat after it: it is not one itself
      if (timeSec >= fromSec && timeSec < toSec) clicks.push({ timeSec, accent: beat === 0 && timeline[i].pickup !== true })
    })
  }
  return clicks
}

/** The bar box the cursor is in and the top of its line, for scroll by line; null outside the map. */
export function followTarget(timeline: SlotTiming[], page: PageLayer, timeSec: number): FollowTarget | null {
  const cursor = cursorAt(timeline, page, timeSec)
  if (cursor === null) return null
  const { box } = cursor
  const onLine = page.bars.filter((other) => other.pageIndex === box.pageIndex && Math.abs(other.y - box.y) <= SAME_LINE_PX)
  const lineFirst = onLine.reduce((best, other) => (other.bar < best.bar ? other : best), box)
  return { box, lineTop: lineFirst.y, pageIndex: box.pageIndex, fraction: cursor.fraction }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function volumeOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback
}

function loopOrNull(value: unknown): LoopRange | null {
  if (!isRecord(value)) return null
  const { startPosition, endPosition } = value
  if (!Number.isInteger(startPosition) || !Number.isInteger(endPosition)) return null
  const [start, end] = [startPosition as number, endPosition as number]
  return start >= 0 && end >= start ? { startPosition: start, endPosition: end } : null
}

/**
 * What a piece remembers of Practice, from the stored jsonb: any value that is missing, of the wrong kind or not one
 * the app offers (an unknown tone, a speed outside 0.25 to 2, a volume outside 0..1) takes its default, field by field.
 */
export function normalizePracticeMemory(stored: unknown): PracticeMemory {
  const defaults = DEFAULT_PRACTICE_MEMORY
  const memory = isRecord(stored) ? stored : {}
  const metronome = isRecord(memory.metronome) ? memory.metronome : {}
  return {
    metronome: {
      on: typeof metronome.on === 'boolean' ? metronome.on : defaults.metronome.on,
      volume: volumeOr(metronome.volume, defaults.metronome.volume),
      tone: CLICK_TONES.find((tone) => tone === metronome.tone) ?? defaults.metronome.tone,
    },
    musicVolume: volumeOr(memory.musicVolume, defaults.musicVolume),
    speed: snapSpeed(memory.speed) ?? defaults.speed,
    loop: loopOrNull(memory.loop),
    loopOn: typeof memory.loopOn === 'boolean' ? memory.loopOn : defaults.loopOn,
    countInEveryRepeat: typeof memory.countInEveryRepeat === 'boolean' ? memory.countInEveryRepeat : defaults.countInEveryRepeat,
    countInMetronome: typeof memory.countInMetronome === 'boolean' ? memory.countInMetronome : defaults.countInMetronome,
  }
}
