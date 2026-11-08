import { BEATS_PER_BAR_CHOICES, type BeatsPerBar } from './beatGrid'
import { type DetectedBeat } from './beats'
import { feltBeats, sameMeter } from './feltBeats'
import { done, refuse, type EditorDoc } from './pieceEdits'
import { expandPlayOrder } from './playOrder'
import { regridLocators, type RegridOutcome } from './regridEdits'
import { locatorsBySlot, meterAt } from './renumber'
import { type Locator, type Meter, type ReviewFlag, type TimingLayer } from './types'

// The pulse card: the processor heard the recording at another beat than the score's and put a pulse flag on a locator (the first
// slot's, when it made it). Its fix is the whole-piece "bar lines on the beats" with N = the beats a bar of the piece's usual meter
// the recording was heard at. The flag stays on its locator when bars are added before it, so the card follows the flag, not the slot.

/** A pulse flag waiting to be acted on: its locator, the flag, the meter N counts in, and the beats a bar to use (null when it is not one the controls have). */
export interface PendingPulse {
  locator: Locator
  flag: ReviewFlag
  /** The meter most of the piece's slots are in: N counts the beats of one bar of it. */
  reference: Meter
  beatsPerBar: BeatsPerBar | null
}

/**
 * Whether a locator (or a review item with a locator's flags) still asks for the lines to go on the beats: it is not checked and
 * holds a pulse flag the score does not explain (severity above 0). The one rule the card's button, the card's edit and the
 * automatic re-grid all go by.
 */
export function isPendingPulse(locator: { checked?: boolean; flags?: readonly ReviewFlag[] }): boolean {
  return locator.checked !== true && findPendingFlag(locator) !== undefined
}

function findPendingFlag(locator: { flags?: readonly ReviewFlag[] }): ReviewFlag | undefined {
  return locator.flags?.find((candidate) => candidate.kind === 'pulse' && candidate.severity > 0)
}

/** The meter the most slots of the order of play are in (a repeated stretch counts each time it is played); the first of two that tie. */
export function referenceMeterOf(timing: TimingLayer): Meter {
  const counts: { meter: Meter; slots: number }[] = []
  for (const slot of expandPlayOrder(timing.playOrder, timing.barCount)) {
    const meter = meterAt(timing.meters, slot.bar)
    const counted = counts.find((entry) => sameMeter(entry.meter, meter))
    if (counted === undefined) counts.push({ meter, slots: 1 })
    else counted.slots += 1
  }
  const most = counts.reduce<{ meter: Meter; slots: number } | undefined>((best, entry) => (best === undefined || entry.slots > best.slots ? entry : best), undefined)
  return most?.meter ?? meterAt(timing.meters, 1)
}

/**
 * The beats a bar of the `reference` meter the recording was heard at, as a whole number the controls have (1 to 6); null for any
 * other. The processor's `found` is the beats it heard in an average slot, and `expected` the felt beats of an average slot, so
 * factor (found / expected) is how much of the score's pulse it heard, whatever the meters are; a bar of the reference meter holds
 * that share of its felt beats. For a piece of one meter that is `found`, rounded.
 */
export function pulseBeatsPerBar(flag: ReviewFlag, reference: Meter): BeatsPerBar | null {
  const factor = flag.factor ?? (flag.expected > 0 ? flag.found / flag.expected : null)
  if (factor === null) return null
  const whole = Math.round(factor * feltBeats(reference))
  return BEATS_PER_BAR_CHOICES.find((choice) => choice === whole) ?? null
}

/**
 * The first pulse flag in the play order that is still waiting (see isPendingPulse), wherever it sits: an added pickup, a bar
 * inserted before bar 1 or a new play order moves it off the first slot. Null when there is none.
 */
export function pendingPulse(timing: TimingLayer): PendingPulse | null {
  if (timing.barCount < 1) return null
  for (const locator of locatorsBySlot(timing)) {
    if (locator === null || !isPendingPulse(locator)) continue
    const flag = findPendingFlag(locator)!
    const reference = referenceMeterOf(timing)
    return { locator, flag, reference, beatsPerBar: pulseBeatsPerBar(flag, reference) }
  }
  return null
}

/**
 * The pulse card's edit: the bar lines of the whole piece (from the first line to the end of the recording) put on the beats,
 * N = the beats a bar the flag says (counted in the piece's usual meter), and every locator that still holds a waiting pulse flag
 * afterwards checked in the same result, so one Undo takes it all back. The flag is looked for after the edit, not by bar: the
 * ripple renumbers bars, and a line the regrid dropped took its flag with it.
 * The outcome is regridLocators' own, so its counts say what happened; it is refused ('out-of-range') when the lines are on those
 * beats already, and when the flag's number is not one of the controls'. Null when no pulse flag is waiting.
 * The locators are checked, not confirmed: pressing the card does not say the lines were heard to be right.
 */
export function regridForPulse(doc: EditorDoc, beats: readonly DetectedBeat[], durationSec: number): RegridOutcome | null {
  const pending = pendingPulse(doc.timing)
  if (pending === null) return null
  if (pending.beatsPerBar === null) return { result: refuse('out-of-range'), placed: 0, removed: 0, dropped: 0, spread: 0 }
  const fromSec = Math.min(...doc.timing.locators.map((locator) => locator.timeSec))
  const outcome = regridLocators(doc, { fromSec, toSec: durationSec, fit: 'ripple' }, beats, pending.beatsPerBar, 0, pending.reference)
  if (!outcome.result.ok) return outcome
  const regridded = outcome.result.doc
  const locators = regridded.timing.locators.map((locator) => (isPendingPulse(locator) ? { ...locator, checked: true } : locator))
  return { ...outcome, result: done({ ...regridded, timing: { ...regridded.timing, locators } }, outcome.result.label, outcome.result.droppedLocators) }
}
