import { meterAt } from './renumber'
import { slotFractions } from './shortBars'
import { type Meter, type PlaySlot, type TimingLayer } from './types'

// How many beats a bar of a meter holds as a player feels them, and what that makes of the beats the tracker hears when
// a stretch has bars of more than one meter. The twin of `units_per_beat` in backend/processor/app/pipeline/structure.py.

/** The numerators of x/8 that are felt in threes: 6/8, 9/8 and 12/8. */
const COMPOUND_NUMERATORS: ReadonlySet<number> = new Set([6, 9, 12])

/** The beats a bar of the meter holds as it is felt: a third of the numerator in compound x/8 (6/8 is 2, 9/8 is 3, 12/8 is 4), else the numerator. */
export function feltBeats(meter: Meter): number {
  return meter.denominator === 8 && COMPOUND_NUMERATORS.has(meter.numerator) ? meter.numerator / 3 : meter.numerator
}

/** True when both are the same meter written the same way: 3/4 is not 6/8, even though both are felt in 2 or 3. */
export function sameMeter(a: Meter, b: Meter): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator
}

/** How many beats of the reference meter a bar of `meter` holds: 1 for the same meter, 2/3 for 2/4 against 3/4. A meter with no beats counts as the reference. */
export function meterRatio(meter: Meter, reference: Meter): number {
  const felt = feltBeats(meter)
  const against = feltBeats(reference)
  return felt > 0 && against > 0 ? felt / against : 1
}

/**
 * What gridTimes needs for each slot, from one pass over the slots. shares: its share of a bar of the reference meter, for gridTimes:
 * its share of a whole bar of its own meter (a pickup or a bar split at a repeat is less than 1), times the beats a bar of its
 * meter holds against a bar of the reference meter. At N beats a bar of the reference meter, a slot spans N x its share heard
 * beats: 2/3 of one beat for a 2/4 bar at N = 1 in 3/4, 3 beats for a 9/8 bar at N = 2 in 6/8.
 * snaps: whether gridTimes may snap its step to a whole beat. A whole bar of another meter has an exact share (3/4 of a beat for
 * a 3/4 bar at N = 1 in 4/4), so it may not: snapping would put it on a beat the music is not on. A bar of the reference meter,
 * and a short bar (a pickup or a bar split at a repeat) in any meter, may, as before.
 */
export function heardBeats(
  slots: readonly Pick<PlaySlot, 'bar'>[],
  timing: Pick<TimingLayer, 'shortBars' | 'meters'>,
  reference: Meter,
): { shares: number[]; snaps: boolean[] } {
  const fractions = slotFractions(slots, timing)
  const ratios = slots.map((slot) => meterRatio(meterAt(timing.meters, slot.bar), reference))
  return {
    shares: fractions.map((fraction, index) => fraction * ratios[index]),
    snaps: fractions.map((fraction, index) => fraction < 1 || ratios[index] === 1),
  }
}
