import { describe, expect, it } from 'vitest'
import { emptyRunsCannotFit, relabelInPlayOrder } from './locatorRemap'
import { type EditorDoc, type EditResult, setPlayOrder } from './pieceEdits'
import { markPickupBar, togglePickup } from './pickup'
import { expandPlayOrder } from './playOrder'
import { slotFractions, slotUnits } from './shortBars'
import { buildTimeline } from './tempo'
import { type Locator, type PlayOrderRow, type ShortBar, type TimingLayer } from './types'

// Mozart's Rondo in small (Erez, 2026-11-06): a 2/4 piece whose sections begin on a pickup, and whose last bar before each
// repeat holds only the beat the pickup does not. Bar 0 and bar 5 are pickups; bars 4 and 9 are the half bars before them.
//   p1 1 2 3 4(half) ||  p5(5) 6 7 8 9(half) ||  p10 11 12 13 14

const SHORT: ShortBar[] = [{ bar: 0, units: 1 }, { bar: 5, units: 1, unnumbered: true }, { bar: 10, units: 1, unnumbered: true }]
const TRUE_ORDER: PlayOrderRow[] = [{ from: 0, to: 4 }, { from: 0, to: 9 }, { from: 5, to: 14 }]
const BAR_SEC = 1

const ok = (result: EditResult) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  return result
}
const key = (l: Pick<Locator, 'bar' | 'passIndex'>) => `${l.bar}:${l.passIndex}`
const loc = (bar: number, passIndex: number, timeSec: number, over: Partial<Locator> = {}): Locator => ({ bar, passIndex, timeSec, confirmed: false, ...over })

function timingOf(playOrder: PlayOrderRow[], locators: Locator[]): TimingLayer {
  return { barCount: 14, playOrder, meters: [{ fromBar: 1, numerator: 2, denominator: 4 }], marks: [], shortBars: SHORT, locators }
}
const docOf = (playOrder: PlayOrderRow[], locators: Locator[], recordingSec?: number): EditorDoc => ({
  timing: timingOf(playOrder, locators),
  pages: [],
  ...(recordingSec === undefined ? {} : { recordingSec }),
})

/** Where each slot of the true order really is on the recording, walking the bars' true lengths. */
function trueTimes(): { key: string; bar: number; passIndex: number; timeSec: number; pickup: boolean }[] {
  const slots = expandPlayOrder(TRUE_ORDER, 14)
  const fractions = slotFractions(slots, timingOf(TRUE_ORDER, []))
  let time = 1
  return slots.map((slot, i) => {
    const entry = { key: key(slot), bar: slot.bar, passIndex: slot.passIndex, timeSec: time, pickup: SHORT.some((s) => s.bar === slot.bar) }
    time += fractions[i] * BAR_SEC
    return entry
  })
}

describe('the length of a slot', () => {
  const slots = expandPlayOrder(TRUE_ORDER, 14)

  it('takes the bar before a pickup as the rest of its meter, per slot', () => {
    const units = slotUnits(slots, timingOf(TRUE_ORDER, []))
    const of = (bar: number, pass: number) => units[slots.findIndex((s) => s.bar === bar && s.passIndex === pass)]
    expect(of(0, 0)).toBe(1) // the pickup
    expect(of(1, 0)).toBeUndefined() // a whole bar
    expect(of(4, 0)).toBe(1) // goes back to the top pickup
    expect(of(4, 1)).toBe(1) // goes on into pickup 5
    expect(of(9, 1)).toBe(1)
  })

  it('leaves a bar whole the time it does not lead into a pickup (a first ending)', () => {
    const rows = [{ from: 1, to: 9 }, { from: 5, to: 8 }, { from: 10, to: 14 }] // 8 leads to 9 first, then to pickup 10
    const expanded = expandPlayOrder(rows, 14)
    const units = slotUnits(expanded, timingOf(rows, []))
    expect(units[expanded.findIndex((s) => s.bar === 8 && s.passIndex === 0)]).toBeUndefined()
    expect(units[expanded.findIndex((s) => s.bar === 8 && s.passIndex === 1)]).toBe(1)
    expect(units[expanded.findIndex((s) => s.bar === 9 && s.passIndex === 0)]).toBe(1)
  })

  it('a short bar that is no pickup leaves the bar before it alone, and a short bar keeps its own length', () => {
    const timing: TimingLayer = { ...timingOf([{ from: 1, to: 14 }], []), shortBars: [{ bar: 6, units: 1 }, { bar: 7, units: 1, unnumbered: true }] }
    const expanded = expandPlayOrder(timing.playOrder, 14)
    const units = slotUnits(expanded, timing)
    expect(units[4]).toBeUndefined() // bar 5, before the short bar 6
    expect(units[5]).toBe(1) // bar 6, short of its own before the pickup
  })

  it('gives the share of a whole bar', () => {
    const fractions = slotFractions(slots, timingOf(TRUE_ORDER, []))
    expect(fractions.slice(0, 6)).toEqual([0.5, 1, 1, 1, 0.5, 0.5])
  })

  it('shares the time between two locators by those lengths on the timeline', () => {
    // Bar 4 (half) at 5 s, bar 6 at 6 s, the pickup between them with no time: it sits halfway.
    const timing = timingOf([{ from: 1, to: 9 }], [loc(1, 0, 2), loc(4, 0, 5), loc(6, 0, 6), loc(7, 0, 7)])
    const timeline = buildTimeline(timing)
    expect(timeline.find((entry) => entry.slot.bar === 5)?.startSec).toBeCloseTo(5.5)
  })
})

describe('emptyRunsCannotFit counts what a run needs', () => {
  const fractionsFor = (rows: PlayOrderRow[]) => slotFractions(expandPlayOrder(rows, 14), timingOf(rows, []))
  const every = Array.from({ length: 10 }, (_, i) => loc(1 + i, 0, 1 + i))

  it('one empty whole bar needs two bars between its neighbours', () => {
    const rows = [{ from: 1, to: 3 }]
    const slots = expandPlayOrder(rows, 14)
    const noRoom = [loc(1, 0, 1), loc(3, 0, 2)]
    const room = [loc(1, 0, 1), loc(3, 0, 3)]
    expect(emptyRunsCannotFit(slots, every, noRoom, undefined, fractionsFor(rows))).toBe(true)
    expect(emptyRunsCannotFit(slots, every, room, undefined, fractionsFor(rows))).toBe(false)
  })

  it('an empty pickup after a half bar needs only the one bar they share', () => {
    const rows = [{ from: 3, to: 6 }]
    const slots = expandPlayOrder(rows, 14)
    const kept = [loc(3, 0, 1), loc(4, 0, 2), loc(6, 0, 3), loc(6, 1, 4)]
    expect(emptyRunsCannotFit(slots, every, kept, undefined, fractionsFor(rows))).toBe(false)
  })
})

describe('relabelInPlayOrder goes by the time between the locators', () => {
  /** Only the bars' downbeats have a time, labelled as if the pickups took none of them. */
  const downbeatsOnly = () => trueTimes().filter((t) => !t.pickup || t.key === '0:0')
  const mislabelled = () => downbeatsOnly().map((t, i) => loc(1 + i > 14 ? 14 : 1 + i, 1 + i > 14 ? 1 + i - 14 : 0, t.timeSec))

  it('lays each downbeat on its whole bar and leaves the pickups empty for the fill', () => {
    const result = ok(relabelInPlayOrder(docOf(TRUE_ORDER, mislabelled())))
    const truth = new Map(trueTimes().map((t) => [t.key, t.timeSec]))
    for (const locator of result.doc.timing.locators) expect(locator.timeSec).toBeCloseTo(truth.get(key(locator)) as number)
    const placed = new Set(result.doc.timing.locators.map(key))
    expect(trueTimes().filter((t) => !placed.has(t.key)).map((t) => t.key)).toEqual(['0:1', '5:0', '5:1', '10:0'])
  })

  it('a locator that sits on a pickup takes the pickup', () => {
    const all = trueTimes().filter((t) => t.key !== '10:0')
    const scrambled = all.map((t, i) => loc(1 + (i % 14), Math.floor(i / 14), t.timeSec))
    const result = ok(relabelInPlayOrder(docOf(TRUE_ORDER, scrambled)))
    const at = (time: number) => result.doc.timing.locators.find((l) => l.timeSec === time)
    const pickup = all.find((t) => t.key === '5:1')
    expect(key(at(pickup?.timeSec as number) as Locator)).toBe('5:1')
  })

  it('a hole in the times leaves its slots empty instead of pulling every later label back', () => {
    const truth = trueTimes()
    const gone = new Set(['7:0', '8:0'])
    const given = truth.filter((t) => (!t.pickup || t.key === '0:0') && !gone.has(t.key))
    const scrambled = given.map((t, i) => loc(1 + (i % 14), Math.floor(i / 14), t.timeSec))
    const result = ok(relabelInPlayOrder(docOf(TRUE_ORDER, scrambled)))
    const placed = new Set(result.doc.timing.locators.map(key))
    expect(placed.has('7:0')).toBe(false)
    expect(placed.has('8:0')).toBe(false)
    const last = result.doc.timing.locators[result.doc.timing.locators.length - 1]
    expect(key(last)).toBe('14:0')
  })
})

describe('relabelInPlayOrder and a long hole', () => {
  it('a hole of many bars takes all of its slots, so the labels after it stay right', () => {
    const rows = [{ from: 1, to: 40 }]
    const given = Array.from({ length: 40 }, (_, i) => i + 1).filter((bar) => bar < 12 || bar > 20)
    const scrambled = given.map((bar, i) => loc(i + 1, 0, bar))
    const doc: EditorDoc = { timing: { barCount: 40, playOrder: rows, meters: [{ fromBar: 1, numerator: 4, denominator: 4 }], marks: [], locators: scrambled }, pages: [] }
    const result = ok(relabelInPlayOrder(doc))
    for (const locator of result.doc.timing.locators) expect(locator.bar).toBe(locator.timeSec)
  })
})

describe('relabelInPlayOrder and a stretched bar', () => {
  const straight = (marks: TimingLayer['marks'], times: number[]): EditorDoc => ({
    timing: { barCount: 12, playOrder: [{ from: 1, to: 12 }], meters: [{ fromBar: 1, numerator: 4, denominator: 4 }], marks, locators: times.map((time, i) => loc(i + 2, 0, time)) },
    pages: [],
  })
  // Ten locators at 1 s a bar, with a long bar 5, and the labels one bar off: two slots are free.
  const times = [1, 2, 3, 4, 5, 8, 9, 10, 11, 12]

  it('a gap on a fermata is the fermata, not a lost bar, so the labels after it stay in step', () => {
    const result = ok(relabelInPlayOrder(straight([{ bar: 5, kind: 'fermata' }], times)))
    expect(result.doc.timing.locators.map((l) => l.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('the same gap with no fermata is two lost bars', () => {
    const result = ok(relabelInPlayOrder(straight([], times)))
    expect(result.doc.timing.locators.map((l) => l.bar)).toEqual([1, 2, 3, 4, 5, 8, 9, 10, 11, 12])
  })

  it('a gap of less than two bars is a slow bar, not a lost one', () => {
    const result = ok(relabelInPlayOrder(straight([], [1, 2, 3, 4, 5, 6.6, 7.6, 8.6, 9.6, 10.6])))
    expect(result.doc.timing.locators.map((l) => l.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('setPlayOrder keeps good times', () => {
  it('relabels when the old labels would drop locators while slots stay empty', () => {
    // The labels say the first section ran on into the second, so the true order has no slot for those labels' second pass.
    const wrong: PlayOrderRow[] = [{ from: 0, to: 4 }, { from: 0, to: 7 }, { from: 5, to: 7 }, { from: 5, to: 14 }]
    const truth = trueTimes()
    const labels = expandPlayOrder(wrong, 14)
    const locators = truth.slice(0, labels.length).map((t, i) => loc(labels[i].bar, labels[i].passIndex, t.timeSec))
    const short: PlayOrderRow[] = TRUE_ORDER
    const result = ok(setPlayOrder(docOf(wrong, locators), short))
    expect(result.droppedLocators).toEqual([])
    expect(result.doc.timing.locators).toHaveLength(locators.length)
    expect(result.label.count ?? 0).toBeGreaterThan(0)
  })
})

describe('marking a pickup moves the rows that meet there', () => {
  const eightBars = (playOrder: PlayOrderRow[], locators: Locator[] = []): EditorDoc => ({
    timing: { barCount: 14, playOrder, meters: [{ fromBar: 1, numerator: 2, denominator: 4 }], marks: [], locators },
    pages: [],
  })

  it('the row starting on the half bar moves to the pickup, and the row ending just before it ends on the half bar', () => {
    // After Add bar line in bar 8: 8 is the half bar, 9 the pickup.
    const after = ok(markPickupBar(eightBars([{ from: 1, to: 7 }, { from: 1, to: 14 }, { from: 8, to: 14 }]), 9))
    expect(after.doc.timing.playOrder).toEqual([{ from: 1, to: 8 }, { from: 1, to: 14 }, { from: 9, to: 14 }])
    expect(after.label.kind).toBe('add-pickup-bar')
  })

  it('a row that ran on onto the pickup comes back to the half bar', () => {
    const after = ok(markPickupBar(eightBars([{ from: 1, to: 9 }, { from: 3, to: 7 }, { from: 8, to: 14 }]), 9))
    expect(after.doc.timing.playOrder).toEqual([{ from: 1, to: 8 }, { from: 3, to: 7 }, { from: 9, to: 14 }])
  })

  it('a row that goes straight on is left alone', () => {
    const rows = [{ from: 1, to: 7 }, { from: 8, to: 14 }]
    const after = ok(markPickupBar(eightBars(rows), 9))
    expect(after.doc.timing.playOrder).toEqual(rows)
  })

  it('a pickup whose box was separate already moves nothing', () => {
    const rows = [{ from: 1, to: 8 }, { from: 1, to: 14 }, { from: 9, to: 14 }]
    expect(ok(markPickupBar(eightBars(rows), 9)).doc.timing.playOrder).toEqual(rows)
  })

  it('locators stay on their times through the move', () => {
    const rows = [{ from: 1, to: 7 }, { from: 1, to: 14 }, { from: 8, to: 14 }]
    const slots = expandPlayOrder(rows, 14)
    const locators = slots.map((slot) => loc(slot.bar, slot.passIndex, 1 + slot.position))
    const after = ok(markPickupBar(eightBars(rows, locators), 9))
    const times = after.doc.timing.locators.map((l) => l.timeSec)
    expect(times.length).toBeGreaterThan(0)
    expect(times.every((time) => locators.some((l) => l.timeSec === time))).toBe(true)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })
})

describe('the pickup toggle', () => {
  const plain = (shortBars?: TimingLayer['shortBars']): EditorDoc => ({
    timing: { barCount: 14, playOrder: [{ from: shortBars?.some((s) => s.bar === 0) ? 0 : 1, to: 14 }], meters: [{ fromBar: 1, numerator: 2, denominator: 4 }], marks: [], locators: [], ...(shortBars === undefined ? {} : { shortBars }) },
    pages: [],
  })

  it('makes a bar in the middle a pickup with one beat, and back', () => {
    const on = ok(togglePickup(plain(), 7))
    expect(on.doc.timing.shortBars).toEqual([{ bar: 7, units: 1, unnumbered: true }])
    expect(on.label.kind).toBe('add-pickup-bar')
    const off = ok(togglePickup(on.doc, 7))
    expect(off.doc.timing.shortBars).toBeUndefined()
    expect(off.label.kind).toBe('remove-pickup-bar')
  })

  it('makes the first bar the top pickup, and bar 0 goes back', () => {
    const on = ok(togglePickup(plain(), 1))
    expect(on.doc.timing.shortBars).toEqual([{ bar: 0, units: 1 }])
    expect(on.label.kind).toBe('toggle-pickup')
    const off = ok(togglePickup(on.doc, 0))
    expect(off.doc.timing.shortBars).toBeUndefined()
    expect(off.doc.timing.barCount).toBe(14)
  })

  it('refuses bar 1 when the piece has a top pickup, because it would sit next to it', () => {
    expect(togglePickup(plain([{ bar: 0, units: 1 }]), 1)).toEqual({ ok: false, reason: 'next-to-pickup' })
  })

  it('refuses the last bar', () => {
    expect(togglePickup(plain(), 14)).toEqual({ ok: false, reason: 'pickup-edge' })
  })
})
