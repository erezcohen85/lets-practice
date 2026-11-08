import { type BarNumber, type Meter, type MeterChange, type PlaySlot, type ShortBar, type TimingLayer } from './types'

/** The length a new pickup starts with, in notes of the meter's denominator (one eighth in 6/8, one quarter in 4/4). */
export const DEFAULT_PICKUP_UNITS = 1

/** What is wrong with one entry of the short-bar list. */
export type ShortBarError = { index: number; problem: 'out-of-range' | 'duplicate' | 'not-shorter' | 'bad-unnumbered' }

/** True when the piece has a pickup: a short bar numbered 0. */
export function hasPickup(timing: Pick<TimingLayer, 'shortBars'>): boolean {
  return (timing.shortBars ?? []).some((short) => short.bar === 0)
}

/** The number of the first bar played in order: 0 with a pickup, else 1. */
export function firstBar(timing: Pick<TimingLayer, 'shortBars'>): BarNumber {
  return hasPickup(timing) ? 0 : 1
}

/** Every bar of the piece, the pickup included: barCount, plus one for bar 0. */
export function barsInPiece(timing: Pick<TimingLayer, 'barCount' | 'shortBars'>): number {
  return timing.barCount + (hasPickup(timing) ? 1 : 0)
}

/**
 * A bar count the way the Bars tab says it: the numbered bars, whether a pickup (bar 0) comes before them, and, when there are
 * some, how many pickups with no number of their own sit in the middle (`pickups`, left out when none).
 */
export type BarTally = { printed: number; pickup: boolean; pickups?: number }

function unnumberedIn(shortBars: readonly ShortBar[] | undefined): Set<BarNumber> {
  return new Set((shortBars ?? []).filter((short) => short.unnumbered === true && short.bar > 0).map((short) => short.bar))
}

function withPickups(tally: BarTally, pickups: number): BarTally {
  return pickups === 0 ? tally : { ...tally, pickups }
}

/** The tally of the piece: barCount minus its unnumbered bars is the numbered count, bar 0 is named apart. */
export function pieceTally(timing: Pick<TimingLayer, 'barCount' | 'shortBars'>): BarTally {
  const unnumbered = [...unnumberedIn(timing.shortBars)].filter((bar) => bar <= timing.barCount).length
  return withPickups({ printed: timing.barCount - unnumbered, pickup: hasPickup(timing) }, unnumbered)
}

/** The tally of a part's boxes, counted the same way: the numbered boxes, a box 0 as the pickup, and the boxes the piece's short bars say are unnumbered. */
export function barTally(boxes: readonly { bar: BarNumber }[], shortBars?: readonly ShortBar[]): BarTally {
  const unnumbered = unnumberedIn(shortBars)
  const inMiddle = boxes.filter((box) => unnumbered.has(box.bar)).length
  return withPickups({ printed: boxes.filter((box) => box.bar >= 1 && !unnumbered.has(box.bar)).length, pickup: boxes.some((box) => box.bar === 0) }, inMiddle)
}

/** The bars that are pickups: bar 0, and the short bars with no number of their own. A short bar that keeps its number is not one. */
export function pickupBars(timing: Pick<TimingLayer, 'shortBars'>): Set<BarNumber> {
  return new Set((timing.shortBars ?? []).filter((short) => short.bar === 0 || short.unnumbered === true).map((short) => short.bar))
}

/** How many notes of the meter's denominator the bar holds when it is shorter than its meter, else undefined. */
export function shortUnits(timing: Pick<TimingLayer, 'shortBars'>, bar: BarNumber): number | undefined {
  return (timing.shortBars ?? []).find((short) => short.bar === bar)?.units
}

/** The meter in force at a bar (the first change covers bars before it, the pickup included); null without meters. */
function meterIn(meters: MeterChange[], bar: BarNumber): Meter | null {
  const sorted = [...meters].sort((a, b) => a.fromBar - b.fromBar)
  let found = sorted[0]
  for (const change of sorted) {
    if (change.fromBar > bar) break
    found = change
  }
  return found === undefined ? null : { numerator: found.numerator, denominator: found.denominator }
}

/**
 * The notes of the meter's denominator each slot holds when it is shorter than its meter: the bar's own short length, or, the
 * times the next slot played is a pickup, the rest of the meter, because a pickup completes the bar before it (Mozart: a bar
 * split at a repeat is both halves of one bar of the music). It goes by the play order, so a first ending that leads back to a
 * pickup is short and the same bar played on into a whole bar is not. Worked out, never stored; the processor's twin is
 * `before_pickup` in refit.py. undefined for a whole bar.
 */
export function slotUnits(slots: readonly Pick<PlaySlot, 'bar'>[], timing: Pick<TimingLayer, 'shortBars' | 'meters'>): (number | undefined)[] {
  const list = timing.shortBars ?? []
  const own = new Map(list.map((short) => [short.bar, short.units]))
  const pickups = pickupBars(timing)
  return slots.map((slot, i) => {
    const mine = own.get(slot.bar)
    if (mine !== undefined) return mine
    const next = slots[i + 1]
    if (next === undefined || !pickups.has(next.bar)) return undefined
    const meter = meterIn(timing.meters, slot.bar)
    const rest = meter === null ? 0 : meter.numerator - (own.get(next.bar) as number)
    return rest > 0 ? rest : undefined
  })
}

/** Each slot's share of a whole bar of its meter: 1 for a whole bar, 0.5 for one beat of 2/4. */
export function slotFractions(slots: readonly Pick<PlaySlot, 'bar'>[], timing: Pick<TimingLayer, 'shortBars' | 'meters'>): number[] {
  const units = slotUnits(slots, timing)
  return slots.map((slot, i) => {
    const held = units[i]
    const meter = meterIn(timing.meters, slot.bar)
    return held === undefined || meter === null ? 1 : held / meter.numerator
  })
}

/**
 * An unnumbered bar reads "p" plus the next numbered bar, so it cannot be the first bar (that is the top pickup, bar 0), the last
 * (no numbered bar follows) or next to another unnumbered bar (both would read the same).
 */
function isBadUnnumbered(bar: BarNumber, shortBars: ShortBar[], barCount: number): boolean {
  if (bar === 1 || bar >= barCount) return true
  return shortBars.some((other) => other.unnumbered === true && (other.bar === bar - 1 || other.bar === bar + 1))
}

/** Whole numbers only; a bar inside the piece (0 only for a pickup); a length of at least 1 and below the meter's. */
export function validateShortBars(shortBars: ShortBar[], meters: MeterChange[], barCount: number): ShortBarError[] {
  const errors: ShortBarError[] = []
  const seen = new Set<BarNumber>()
  shortBars.forEach((short, index) => {
    if (!Number.isInteger(short.bar) || short.bar < 0 || short.bar > barCount || !Number.isInteger(short.units)) {
      errors.push({ index, problem: 'out-of-range' })
      return
    }
    if (seen.has(short.bar)) {
      errors.push({ index, problem: 'duplicate' })
      return
    }
    seen.add(short.bar)
    const meter = meterIn(meters, short.bar)
    if (short.units < 1 || (meter !== null && short.units >= meter.numerator)) errors.push({ index, problem: 'not-shorter' })
    else if (short.unnumbered === true && short.bar > 0 && isBadUnnumbered(short.bar, shortBars, barCount)) errors.push({ index, problem: 'bad-unnumbered' })
  })
  return errors
}

/** The short bars in bar order, copied; undefined when there are none (an old map has no list). */
export function tidyShortBars(shortBars: ShortBar[]): ShortBar[] | undefined {
  return shortBars.length === 0 ? undefined : shortBars.map((short) => ({ ...short })).sort((a, b) => a.bar - b.bar)
}
