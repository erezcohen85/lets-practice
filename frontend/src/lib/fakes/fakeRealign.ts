import { expandPlayOrder } from '@/domain/playOrder'
import { type Locator, type TimingLayer } from '@/domain/types'
import { meterAt, unmatchedSlots } from '@/domain/renumber'
import { shortUnits } from '@/domain/shortBars'

/** An anchor: the slot (position in the expanded play order) and the time its locator keeps. */
interface Anchor { position: number; timeSec: number; confirmed: boolean }

/**
 * The fake's realign (the real one is align.py, Phase 2): confirmed locators never move; every other slot of the
 * expanded play order gets a locator spread evenly by beats between the confirmed anchors (before the first anchor and
 * after the last, at the local tempo of the nearest anchors); unconfirmed old times are ignored.
 * With no confirmed locator, the first and last unconfirmed ones are the frame and the rest is spread between them.
 * Each locator keeps its flags and checked by (bar, pass); a locator the realign adds has none.
 */
export function fakeRealign(timing: TimingLayer, recordingEndSec: number): TimingLayer {
  const slots = expandPlayOrder(timing.playOrder, timing.barCount)
  // beatsBefore[i] = beats from the start of the play order to the start of slot i; the last entry is the total.
  const beatsBefore = [0]
  for (const slot of slots) beatsBefore.push(beatsBefore[beatsBefore.length - 1] + (shortUnits(timing, slot.bar) ?? meterAt(timing.meters, slot.bar).numerator))

  const positionOf = new Map<string, number>()
  for (const slot of slots) positionOf.set(`${slot.bar}:${slot.passIndex}`, slot.position)
  const old = new Map<number, Locator>()
  for (const locator of timing.locators) {
    const position = positionOf.get(`${locator.bar}:${locator.passIndex}`)
    if (position !== undefined && !old.has(position)) old.set(position, locator)
  }
  const located = [...old.keys()].sort((a, b) => a - b)

  const anchors: Anchor[] = []
  const confirmedPositions = located.filter((position) => old.get(position)?.confirmed === true)
  const framePositions = confirmedPositions.length > 0 ? confirmedPositions : [located[0], located[located.length - 1]]
  for (const position of new Set(framePositions)) {
    const locator = old.get(position)
    if (locator !== undefined) anchors.push({ position, timeSec: locator.timeSec, confirmed: locator.confirmed })
  }

  const times = anchors.length === 0 ? spreadOverRecording(beatsBefore, recordingEndSec) : spreadBetween(anchors, beatsBefore, recordingEndSec)
  const confirmedAt = new Set(anchors.filter((anchor) => anchor.confirmed).map((anchor) => anchor.position))
  return {
    barCount: timing.barCount,
    playOrder: timing.playOrder.map((row) => ({ ...row })),
    meters: timing.meters.map((change) => ({ ...change })),
    marks: timing.marks.map((mark) => ({ ...mark })),
    ...(timing.shortBars === undefined ? {} : { shortBars: timing.shortBars.map((short) => ({ ...short })) }),
    locators: slots.map((slot) => {
      const previous = old.get(slot.position)
      return {
        bar: slot.bar,
        passIndex: slot.passIndex,
        timeSec: times[slot.position],
        confirmed: confirmedAt.has(slot.position),
        // The review state belongs to the (bar, pass), not to the time: a refit locator keeps it, a new one has none.
        ...(previous?.flags === undefined ? {} : { flags: previous.flags.map((flag) => ({ ...flag })) }),
        ...(previous?.checked === undefined ? {} : { checked: previous.checked }),
      }
    }),
  }
}

/** No anchor at all: the slots share the whole recording by beats. */
function spreadOverRecording(beatsBefore: number[], recordingEndSec: number): number[] {
  const total = beatsBefore[beatsBefore.length - 1]
  return beatsBefore.slice(0, -1).map((beats) => (recordingEndSec * beats) / total)
}

function spreadBetween(anchors: Anchor[], beatsBefore: number[], recordingEndSec: number): number[] {
  const slotCount = beatsBefore.length - 1
  const times = new Array<number>(slotCount)
  const total = beatsBefore[slotCount]
  const first = anchors[0]
  const last = anchors[anchors.length - 1]

  // Seconds per beat between two anchors; with a single anchor, what is left of the recording after it.
  const tempoBetween = (from: Anchor, to: Anchor) => (to.timeSec - from.timeSec) / (beatsBefore[to.position] - beatsBefore[from.position])
  const alone = anchors.length === 1
  const fallback = Math.max(0.01, (recordingEndSec - first.timeSec) / Math.max(1, total - beatsBefore[first.position]))
  let tempoBefore = alone ? fallback : tempoBetween(anchors[0], anchors[1])
  let tempoAfter = alone ? fallback : tempoBetween(anchors[anchors.length - 2], last)

  for (let k = 0; k < anchors.length - 1; k++) {
    const from = anchors[k]
    const to = anchors[k + 1]
    const tempo = tempoBetween(from, to)
    for (let i = from.position; i < to.position; i++) times[i] = from.timeSec + (beatsBefore[i] - beatsBefore[from.position]) * tempo
  }

  // Before the first anchor: never earlier than 0, and every slot a little after the one before it.
  const beatsBeforeFirst = beatsBefore[first.position]
  if (beatsBeforeFirst > 0) tempoBefore = Math.min(tempoBefore, first.timeSec / (beatsBeforeFirst + 0.5))
  for (let i = 0; i < first.position; i++) times[i] = first.timeSec - (beatsBeforeFirst - beatsBefore[i]) * tempoBefore

  // After the last anchor: the last slot starts before the recording ends, unless the anchor itself is past the end.
  const beatsToLastSlot = beatsBefore[slotCount - 1] - beatsBefore[last.position]
  if (beatsToLastSlot > 0 && recordingEndSec > last.timeSec) {
    tempoAfter = Math.min(tempoAfter, (recordingEndSec - last.timeSec) / (beatsToLastSlot + 0.5))
  }
  for (let i = last.position; i < slotCount; i++) times[i] = last.timeSec + (beatsBefore[i] - beatsBefore[last.position]) * tempoAfter

  for (const anchor of anchors) times[anchor.position] = anchor.timeSec
  return times
}

/**
 * The fake's fill (the real one is fill.py): the same spread as the realign, with every locator that is there held where it
 * is, so only the empty slots get a time. Null when there is nothing to fill or no locator to fill around.
 */
export function fakeFill(timing: TimingLayer, recordingEndSec: number): TimingLayer | null {
  if (unmatchedSlots(timing).length === 0 || timing.locators.length === 0) return null
  const spread = fakeRealign({ ...timing, locators: timing.locators.map((locator) => ({ ...locator, confirmed: true })) }, recordingEndSec)
  const had = new Map(timing.locators.map((locator) => [`${locator.bar}:${locator.passIndex}`, locator]))
  return { ...spread, locators: spread.locators.map((locator) => had.get(`${locator.bar}:${locator.passIndex}`) ?? { ...locator, confirmed: false }) }
}
