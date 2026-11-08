import { describe, expect, it } from 'vitest'
import { type DetectedBeat } from './beats'
import { createHistory, nextUndo, record, undo } from './history'
import { type EditorDoc, type EditResult } from './pieceEdits'
import { expandPlayOrder } from './playOrder'
import { GRID_SNAP_SEC, planContinue, planContinueOrWhy, planRegrid, regridLocators, type RegridStretch } from './regridEdits'
import { type MeterChange, type PlayOrderRow, type TimingLayer } from './types'

// A synthetic 3/4 piece of 20 bars. The recording has a beat every 0.84 s, three to a bar and 60 in all, and the lines
// are the aligner's guesses, one on every 3rd beat, unless a test says otherwise. Places are given in beats from the
// first beat: beatTime(3.5) is half way between the 4th and the 5th beat.
const BAR_COUNT = 20
const BEAT_COUNT = BAR_COUNT * 3
const BEAT_SEC = 0.84
const FIRST_BEAT_SEC = 1
const beatTime = (beat: number): number => FIRST_BEAT_SEC + BEAT_SEC * beat
const DURATION_SEC = beatTime(BEAT_COUNT)
const beats: DetectedBeat[] = Array.from({ length: BEAT_COUNT }, (_, i) => ({ t: beatTime(i), downbeat: i % 3 === 0 ? 0.9 : 0.1 }))

/** bar -> beat for the bars `fromBar` to `toBar`. */
const guesses = (fromBar: number, toBar: number, beatOf: (bar: number) => number): Record<number, number> =>
  Object.fromEntries(Array.from({ length: toBar - fromBar + 1 }, (_, i) => [fromBar + i, beatOf(fromBar + i)]))
/** One line for each of the 20 bars, `step` beats apart. */
const everyNth = (step: number): Record<number, number> => guesses(1, BAR_COUNT, (bar) => (bar - 1) * step)
/** Bars 1 to 4 on the first four beats: one beat a bar. */
const onEveryBeat: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3 }

/** The doc of bar -> beat lines; the bars in `checkedBars` are confirmed. `timing` replaces parts of the timing layer; `shiftSec` moves every line. */
function pulseDoc(beatOfBar: Record<number, number>, checkedBars: readonly number[] = [], timing: Partial<TimingLayer> = {}, shiftSec = 0): EditorDoc {
  const locators = Object.entries(beatOfBar).map(([bar, beat]) => ({
    bar: Number(bar),
    passIndex: 0,
    timeSec: beatTime(beat) + shiftSec,
    confirmed: checkedBars.includes(Number(bar)),
  }))
  return {
    timing: { barCount: BAR_COUNT, playOrder: [{ from: 1, to: BAR_COUNT }], meters: [{ fromBar: 1, numerator: 3, denominator: 4 }], marks: [], locators, ...timing },
    pages: [],
  }
}

/**
 * A doc with a repeat: one line per play-order slot (slot positions count from 0), on the beat `beatOfSlot` gives, or none
 * when it gives null; the slots in `checkedSlots` are confirmed.
 */
function repeatDoc(playOrder: PlayOrderRow[], barCount: number, beatOfSlot: (position: number) => number | null, checkedSlots: readonly number[] = []): EditorDoc {
  const locators = expandPlayOrder(playOrder, barCount).flatMap((slot) => {
    const beat = beatOfSlot(slot.position)
    return beat === null ? [] : [{ bar: slot.bar, passIndex: slot.passIndex, timeSec: beatTime(beat), confirmed: checkedSlots.includes(slot.position) }]
  })
  return { timing: { barCount, playOrder, meters: [{ fromBar: 1, numerator: 3, denominator: 4 }], marks: [], locators }, pages: [] }
}
/** Bars 1 to 4, then 3 to 8: 10 slots, bars 3 and 4 played twice. */
const REPEAT_BARS_3_TO_4: PlayOrderRow[] = [{ from: 1, to: 4 }, { from: 3, to: 8 }]
/** Bars 1 to 8, then 3 to 8: 14 slots, bars 3 to 8 played twice. */
const REPEAT_BARS_3_TO_8: PlayOrderRow[] = [{ from: 1, to: 8 }, { from: 3, to: 8 }]

/** Every line sits on a slot of the play order, no two on one slot, and slot order is time order. */
function expectLabelsConsistent(doc: EditorDoc): void {
  const slots = expandPlayOrder(doc.timing.playOrder, doc.timing.barCount)
  const positions = doc.timing.locators.map((l) => slots.findIndex((s) => s.bar === l.bar && s.passIndex === l.passIndex))
  expect(positions.every((p) => p >= 0), 'every line is on a slot of the play order').toBe(true)
  expect(positions.every((p, i) => i === 0 || p > positions[i - 1]), 'lines are in slot order, one to a slot').toBe(true)
  expect(doc.timing.locators.every((l, i) => i === 0 || l.timeSec > doc.timing.locators[i - 1].timeSec), 'times rise along the slots').toBe(true)
}

const stretch = (fromBeat: number, toBeat: number, fit: RegridStretch['fit'] = 'ripple'): RegridStretch => ({ fromSec: beatTime(fromBeat), toSec: beatTime(toBeat), fit })
const whole: RegridStretch = { fromSec: beatTime(0), toSec: DURATION_SEC, fit: 'ripple' }

const lineOf = (doc: EditorDoc, bar: number, passIndex = 0) => doc.timing.locators.find((l) => l.bar === bar && l.passIndex === passIndex)
const timeOf = (doc: EditorDoc, bar: number): number => lineOf(doc, bar)!.timeSec
/** The doc has these bars on these beats (to a millisecond), and none of them checked unless it says so. */
function expectOnBeats(doc: EditorDoc, beatOfBar: Record<number, number>): void {
  for (const [bar, beat] of Object.entries(beatOfBar)) expect(timeOf(doc, Number(bar)), `bar ${bar}`).toBeCloseTo(beatTime(beat), 3)
}
function expectUnchanged(after: EditorDoc, before: EditorDoc, bars: readonly number[]): void {
  for (const bar of bars) expect(lineOf(after, bar), `bar ${bar}`).toEqual(lineOf(before, bar))
}
function expectTimes(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((time, index) => expect(actual[index]).toBeCloseTo(time, 3))
}
const rangeOf = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

function ok(result: EditResult): Extract<EditResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected an edit, got a refusal: ${result.reason}`)
  return result
}

describe('GRID_SNAP_SEC', () => {
  it('holds the agreed value', () => {
    expect(GRID_SNAP_SEC).toBe(0.08)
  })
})

describe('planRegrid', () => {
  it('puts a target on every beat for one beat a bar, keeps the guesses already on a beat and deletes those past the last bar', () => {
    const plan = planRegrid(pulseDoc(everyNth(3)), whole, beats, 1)
    expect(plan.beatsPerBar).toBe(1)
    // 20 bars, so 20 beats get a line
    expectTimes(plan.targets, rangeOf(0, 19).map(beatTime))
    // the guesses on beats 0, 3, ... 18 are on a target; the 13 added are the other beats
    expectTimes(plan.adds, rangeOf(0, 19).filter((beat) => beat % 3 !== 0).map(beatTime))
    // the guesses of bars 8 to 20 (beat 21 on) have no target near them
    expect(plan.deletes).toEqual(rangeOf(8, 20).map((bar) => ({ bar, passIndex: 0 })))
  })

  it('never deletes a checked line, and adds no line within the snap distance of one', () => {
    // Bar 10 is checked on beat 27, where no target is; bar 2 is checked a little after beat 1.
    const doc = pulseDoc({ ...everyNth(3), 2: 1 + 0.05 / BEAT_SEC, 10: 27 }, [2, 10])
    const plan = planRegrid(doc, whole, beats, 1)
    expect(plan.deletes.map((d) => d.bar)).not.toContain(10)
    expect(plan.deletes.map((d) => d.bar)).toEqual([8, 9, ...rangeOf(11, 20)])
    expect(plan.adds.some((time) => Math.abs(time - beatTime(1)) < 0.2)).toBe(false)
    expect(plan.adds).toHaveLength(13)
  })

  it('counts a guess within the snap distance of a target as on it, and one farther as off it', () => {
    const near = pulseDoc({ ...everyNth(3), 3: 6 + (GRID_SNAP_SEC - 0.01) / BEAT_SEC })
    expect(planRegrid(near, whole, beats, 3)).toMatchObject({ adds: [], deletes: [] })
    const far = pulseDoc({ ...everyNth(3), 3: 6 + (GRID_SNAP_SEC + 0.02) / BEAT_SEC })
    const plan = planRegrid(far, whole, beats, 3)
    expect(plan.deletes).toEqual([{ bar: 3, passIndex: 0 }])
    expectTimes(plan.adds, [beatTime(6)])
  })

  it('deletes only the guesses strictly inside the stretch', () => {
    // Beats 6 to 30: the guesses on beat 6 (bar 3) and beat 30 (bar 11) are the edges and stay.
    const plan = planRegrid(pulseDoc(everyNth(3)), stretch(6, 30), beats, 1)
    // 18 bars from bar 3 on are left to give lines to, so the targets are beats 6 to 23
    expectTimes(plan.targets, rangeOf(6, 23).map(beatTime))
    expect(plan.deletes).toEqual([{ bar: 9, passIndex: 0 }, { bar: 10, passIndex: 0 }])
    expect(plan.adds).toHaveLength(12)
    expect(plan.adds.every((time) => time > beatTime(6) && time < beatTime(24))).toBe(true)
  })

  it('deletes every second guess when the bars are made twice as long', () => {
    const plan = planRegrid(pulseDoc(everyNth(1)), stretch(0, 20), beats, 2)
    expect(plan.adds).toEqual([])
    expect(plan.deletes).toEqual(rangeOf(1, 10).map((i) => ({ bar: 2 * i, passIndex: 0 })))
    expectTimes(plan.targets, rangeOf(0, 9).map((i) => beatTime(2 * i)))
  })

  it('does nothing without beats to put lines on', () => {
    expect(planRegrid(pulseDoc(everyNth(3)), whole, [], 1)).toEqual({ targets: [], adds: [], deletes: [], beatsPerBar: 1 })
    expect(planRegrid(pulseDoc(everyNth(3)), whole, [beats[0]], 1)).toEqual({ targets: [], adds: [], deletes: [], beatsPerBar: 1 })
  })

  it('gives a pickup its share of the beats and starts the first bar after it', () => {
    // Bar 0 holds one third of a 3/4 bar: one beat. Then a bar is 3 beats.
    const doc = pulseDoc({ 0: 0 }, [], { playOrder: [{ from: 0, to: BAR_COUNT }], shortBars: [{ bar: 0, units: 1 }] })
    const plan = planRegrid(doc, whole, beats, 3)
    expectTimes(plan.targets.slice(0, 4), [beatTime(0), beatTime(1), beatTime(4), beatTime(7)])
    expect(plan.targets).toHaveLength(BAR_COUNT + 1)
  })

  it('gives the bar before a pickup the rest of its meter', () => {
    // Bars 1 to 3, then the pickup (bar 0, one beat), then bar 1 again: bar 3 is two beats long.
    const doc = pulseDoc({ 1: 0 }, [], { playOrder: [{ from: 1, to: 3 }, { from: 0, to: 0 }, { from: 1, to: BAR_COUNT }], shortBars: [{ bar: 0, units: 1 }] })
    const plan = planRegrid(doc, whole, beats, 3)
    expectTimes(plan.targets.slice(0, 6), [beatTime(0), beatTime(3), beatTime(6), beatTime(8), beatTime(9), beatTime(12)])
  })
})

describe('regridLocators, ripple', () => {
  it('puts a line on every beat for one beat a bar, and the guesses already on a beat follow to their new bars', () => {
    const doc = pulseDoc(everyNth(3))
    const outcome = regridLocators(doc, whole, beats, 1)
    const result = ok(outcome.result)
    expect(outcome).toMatchObject({ placed: 13, removed: 13, dropped: 0, spread: 0 })
    expect(result.label).toEqual({ kind: 'regrid' })
    expectOnBeats(result.doc, Object.fromEntries(rangeOf(1, 20).map((bar) => [bar, bar - 1])))
    expect(result.doc.timing.locators).toHaveLength(20)
    // new lines are guesses
    expect(result.doc.timing.locators.every((l) => !l.confirmed)).toBe(true)
    // bar 2's guess (beat 3) is the same locator, now bar 4
    expect(lineOf(result.doc, 4)).toEqual({ ...lineOf(doc, 2), bar: 4 })
  })

  it('is one undo step', () => {
    const doc = pulseDoc(everyNth(3))
    const result = ok(regridLocators(doc, whole, beats, 1).result)
    const history = record(createHistory(doc), result.label, result.doc)
    expect(history.past).toHaveLength(1)
    expect(nextUndo(history)).toEqual({ kind: 'regrid' })
    expect(undo(history).present).toBe(doc)
  })

  it('keeps the time of a checked line, and its check, wherever the new lines go', () => {
    const doc = pulseDoc({ ...everyNth(3), 5: 12 }, [5])
    const result = ok(regridLocators(doc, whole, beats, 1).result)
    // beat 12 is bar 13 now
    expect(lineOf(result.doc, 13)).toEqual({ bar: 13, passIndex: 0, timeSec: beatTime(12), confirmed: true })
    expect(result.doc.timing.locators.filter((l) => l.confirmed)).toHaveLength(1)
  })

  it('keeps a checked line that is off the beats where it is, and puts no line over it', () => {
    // Bar 5 is checked half a beat after beat 12; the beats around it are far enough off to get lines.
    const doc = pulseDoc({ ...everyNth(3), 5: 12.5 }, [5])
    const outcome = regridLocators(doc, whole, beats, 1)
    const result = ok(outcome.result)
    const checked = result.doc.timing.locators.filter((l) => l.confirmed)
    expect(checked).toHaveLength(1)
    expect(checked[0].timeSec).toBe(beatTime(12.5))
    // the extra line in the middle uses a bar, so the last beat has none left
    expect(result.doc.timing.locators).toHaveLength(BAR_COUNT)
    expect(outcome.placed).toBe(13)
    expect(result.doc.timing.locators.map((l) => l.timeSec)).toEqual([...result.doc.timing.locators.map((l) => l.timeSec)].sort((a, b) => a - b))
  })

  it('makes the bars twice as long by deleting every second guess, and the bars after follow up', () => {
    const doc = pulseDoc(everyNth(1))
    const outcome = regridLocators(doc, stretch(0, 20), beats, 2)
    const result = ok(outcome.result)
    expect(outcome).toMatchObject({ placed: 0, removed: 10, dropped: 0, spread: 0 })
    expect(result.doc.timing.locators).toHaveLength(10)
    expectOnBeats(result.doc, Object.fromEntries(rangeOf(1, 10).map((bar) => [bar, 2 * (bar - 1)])))
    expect(result.label.kind).toBe('regrid')
  })

  it('moves the bars after the stretch up by the lines it added, and reports the ones that fall off the end', () => {
    // Beats 0 to 12 get a line each: 8 new lines, so every later bar is 8 bars higher and the last 8 are past bar 20.
    const doc = pulseDoc(everyNth(3))
    const outcome = regridLocators(doc, stretch(0, 12), beats, 1)
    const result = ok(outcome.result)
    expect(outcome).toMatchObject({ placed: 8, removed: 0, dropped: 8 })
    expect(result.droppedLocators).toHaveLength(8)
    expectOnBeats(result.doc, { ...Object.fromEntries(rangeOf(1, 12).map((bar) => [bar, bar - 1])), 13: 12, 20: 33 })
    expect(result.doc.timing.locators).toHaveLength(BAR_COUNT)
  })

  it('fills the free bars between two lines before it renumbers anything', () => {
    const doc = pulseDoc({ 1: 0, 5: 12 })
    const outcome = regridLocators(doc, stretch(0, 13), beats, 3)
    const result = ok(outcome.result)
    expect(outcome).toMatchObject({ placed: 3, removed: 0, dropped: 0 })
    expectOnBeats(result.doc, { 1: 0, 2: 3, 3: 6, 4: 9, 5: 12 })
    expect(lineOf(result.doc, 5)).toEqual(lineOf(doc, 5))
    expect(lineOf(result.doc, 2)!.confirmed).toBe(false)
  })

  it('refuses when nothing would change', () => {
    const outcome = regridLocators(pulseDoc(everyNth(3)), whole, beats, 3)
    expect(outcome.result).toEqual({ ok: false, reason: 'out-of-range' })
    expect(outcome).toMatchObject({ placed: 0, removed: 0, dropped: 0, spread: 0 })
  })

  it('refuses without beats', () => {
    expect(regridLocators(pulseDoc(everyNth(3)), whole, [], 1).result).toEqual({ ok: false, reason: 'out-of-range' })
  })

  it('refuses rather than push a checked line off the last bar', () => {
    // A 6-bar piece; bar 6 is checked on beat 15. Lines on beats 1 and 2 would push it past bar 6.
    const doc = pulseDoc({ 1: 0, 2: 3, 3: 6, 4: 9, 5: 12, 6: 15 }, [6], { barCount: 6, playOrder: [{ from: 1, to: 6 }] })
    const outcome = regridLocators(doc, stretch(0, 12), beats, 1)
    expect(outcome.result).toEqual({ ok: false, reason: 'no-free-slot' })
    expect(outcome).toMatchObject({ placed: 0, removed: 0, dropped: 0 })
  })

  it('follows a line dragged in this visit to its new bar', () => {
    const doc = { ...pulseDoc({ ...everyNth(3), 5: 12 }, [5]), moved: [{ bar: 5, passIndex: 0, fromSec: beatTime(12) - 1, wasConfirmed: false }] }
    const result = ok(regridLocators(doc, whole, beats, 1).result)
    expect(result.doc.moved).toEqual([{ bar: 13, passIndex: 0, fromSec: beatTime(12) - 1, wasConfirmed: false }])
  })

  describe('across a repeat', () => {
    // Bars 1 to 4, then 3 to 8: ten slots, [1, 2, 3, 4, 3 (2nd), 4 (2nd), 5, 6, 7, 8], a guess on every 3rd beat.
    const repeated = () => repeatDoc(REPEAT_BARS_3_TO_4, 8, (p) => 3 * p)
    const labelsOf = (doc: EditorDoc) => doc.timing.locators.map((l) => [l.bar, l.passIndex])

    it('puts a line on every beat and names each slot of the repeat, passes included', () => {
      const outcome = regridLocators(repeated(), whole, beats, 1)
      const result = ok(outcome.result)
      expect(outcome).toMatchObject({ placed: 6, removed: 6, dropped: 0 })
      expect(labelsOf(result.doc)).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [3, 1], [4, 1], [5, 0], [6, 0], [7, 0], [8, 0]])
      result.doc.timing.locators.forEach((l, index) => expect(l.timeSec).toBeCloseTo(beatTime(index), 3))
      expect(result.doc.timing.locators.every((l) => !l.confirmed)).toBe(true)
      expectLabelsConsistent(result.doc)
    })

    it('moves the lines after the stretch to the slots the new lines made room for, across the repeat', () => {
      // Beats 0 to 6 get a line each: 4 new lines, so every later line moves up 4 slots and the last 4 fall off.
      const doc = repeated()
      const outcome = regridLocators(doc, stretch(0, 6), beats, 1)
      const result = ok(outcome.result)
      expect(outcome).toMatchObject({ placed: 4, removed: 0, dropped: 4 })
      // the lines of beats 27, 24, 21 and 18, in the order the adds pushed them off
      expectTimes(result.droppedLocators.map((l) => l.timeSec), [27, 24, 21, 18].map(beatTime))
      // beats 0 to 5 are slots 0 to 5; the old lines on beats 6, 9, 12 and 15 are on slots 6 to 9
      const onBeat = (beat: number) => result.doc.timing.locators.find((l) => Math.abs(l.timeSec - beatTime(beat)) < 1e-6)!
      expect([0, 1, 2, 3, 4, 5, 6, 9, 12, 15].map((beat) => [onBeat(beat).bar, onBeat(beat).passIndex])).toEqual([
        [1, 0], [2, 0], [3, 0], [4, 0], [3, 1], [4, 1], [5, 0], [6, 0], [7, 0], [8, 0],
      ])
      expect(result.doc.timing.locators).toHaveLength(10)
      expectLabelsConsistent(result.doc)
    })

    it('deletes a repeated bar by its pass and closes up the lines that are left across the repeat', () => {
      // A line on every beat, the bars made twice as long: the lines on the odd beats go, among them both passes of bar 4.
      const doc = repeatDoc(REPEAT_BARS_3_TO_4, 8, (p) => p)
      const outcome = regridLocators(doc, stretch(0, 10), beats, 2)
      const result = ok(outcome.result)
      expect(outcome).toMatchObject({ placed: 0, removed: 5, dropped: 0 })
      expect(labelsOf(result.doc)).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [3, 1]])
      result.doc.timing.locators.forEach((l, index) => expect(l.timeSec).toBeCloseTo(beatTime(2 * index), 3))
      expectLabelsConsistent(result.doc)
    })
  })
})

describe('regridLocators, between', () => {
  /** Bars 1 to 4 checked on beats 0 to 3, guesses half a beat early on bars 5 to 11, bar 12 checked on beat 11, then guesses. */
  const betweenDoc = (): EditorDoc =>
    pulseDoc({ ...onEveryBeat, ...guesses(5, 11, (bar) => bar - 0.5), 12: 11, ...guesses(13, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4, 12])

  it('puts a line on each beat between the start line and the end line and renumbers nothing', () => {
    const doc = betweenDoc()
    const outcome = regridLocators(doc, stretch(3, 11, 'between'), beats, 1)
    const result = ok(outcome.result)
    expect(outcome).toMatchObject({ placed: 7, removed: 0, dropped: 0, spread: 0 })
    expect(result.label).toEqual({ kind: 'regrid' })
    expect(result.droppedLocators).toEqual([])
    expectOnBeats(result.doc, Object.fromEntries(rangeOf(5, 11).map((bar) => [bar, bar - 1])))
    for (const bar of rangeOf(5, 11)) expect(lineOf(result.doc, bar)!.confirmed).toBe(false)
    // the checked bars, the end line and every line after it are as they were
    expectUnchanged(result.doc, doc, [1, 2, 3, 4, ...rangeOf(12, 20)])
    expect(result.doc.timing.locators).toHaveLength(BAR_COUNT)
  })

  it('is one undo step', () => {
    const doc = betweenDoc()
    const result = ok(regridLocators(doc, stretch(3, 11, 'between'), beats, 1).result)
    const history = record(createHistory(doc), result.label, result.doc)
    expect(history.past).toHaveLength(1)
    expect(undo(history).present).toBe(doc)
  })

  it('spreads the lines the beats do not give evenly before the end line', () => {
    // Bar 16 is the end line on beat 11: bars 5 to 15 are 11 lines, and the beats give 7 of them (4 to 10).
    const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 15, (bar) => 3 + (bar - 4) * 0.6), 16: 11, ...guesses(17, 20, (bar) => 40 + bar - 17) }, [1, 2, 3, 4, 16])
    const outcome = regridLocators(doc, stretch(3, 11, 'between'), beats, 1)
    const result = ok(outcome.result)
    expect(outcome).toMatchObject({ placed: 11, removed: 0, dropped: 0, spread: 4 })
    expectOnBeats(result.doc, { ...Object.fromEntries(rangeOf(5, 11).map((bar) => [bar, bar - 1])), 12: 10.2, 13: 10.4, 14: 10.6, 15: 10.8 })
    expectUnchanged(result.doc, doc, [1, 2, 3, 4, 16, 17, 18, 19, 20])
  })

  it('uses no more beats than there are bars between the lines', () => {
    // Only bar 5 lies between bar 4 and the end line, bar 6 on beat 11.
    const doc = pulseDoc({ ...onEveryBeat, 5: 3.5, 6: 11, ...guesses(7, 20, (bar) => bar + 5) }, [1, 2, 3, 4, 6])
    const outcome = regridLocators(doc, stretch(3, 11, 'between'), beats, 1)
    const result = ok(outcome.result)
    expect(outcome).toMatchObject({ placed: 1, spread: 0 })
    expectOnBeats(result.doc, { 5: 4 })
    expectUnchanged(result.doc, doc, [1, 2, 3, 4, 6, ...rangeOf(7, 20)])
  })

  it('fills the bars after the start line to the end of the recording when there is no end line, and removes the guesses it cannot reach', () => {
    // The recording ends on beat 12. Bars 5 to 20 are guesses crowded between beats 3.5 and 11.
    const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 20, (bar) => 3 + (bar - 4) * 0.5) }, [1, 2, 3, 4])
    const outcome = regridLocators(doc, stretch(3, 12, 'between'), beats, 1)
    const result = ok(outcome.result)
    expect(outcome).toMatchObject({ placed: 8, removed: 8, dropped: 0, spread: 0 })
    expectOnBeats(result.doc, Object.fromEntries(rangeOf(5, 12).map((bar) => [bar, bar - 1])))
    expect(result.doc.timing.locators.map((l) => l.bar)).toEqual(rangeOf(1, 12))
    expectUnchanged(result.doc, doc, [1, 2, 3, 4])
  })

  it('fills bars that have no line yet', () => {
    const doc = pulseDoc(onEveryBeat, [1, 2, 3, 4])
    const result = ok(regridLocators(doc, { fromSec: beatTime(3), toSec: DURATION_SEC, fit: 'between' }, beats, 1).result)
    // 16 bars are left, so beats 3 to 18 get the lines of bars 4 to 20 (bar 4 is the start line)
    expectOnBeats(result.doc, Object.fromEntries(rangeOf(1, 20).map((bar) => [bar, bar - 1])))
    expect(result.doc.timing.locators).toHaveLength(BAR_COUNT)
  })

  it('leaves a checked line between the lines where it is', () => {
    const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 11, (bar) => bar - 0.5), 8: 7.3, 12: 11 }, [1, 2, 3, 4, 8, 12])
    const outcome = regridLocators(doc, stretch(3, 11, 'between'), beats, 1)
    const result = ok(outcome.result)
    expect(outcome.placed).toBe(6)
    expectUnchanged(result.doc, doc, [8, 12])
    expectOnBeats(result.doc, { 5: 4, 6: 5, 7: 6, 9: 8, 10: 9, 11: 10 })
  })

  it('refuses when a checked line between the lines would end up out of order', () => {
    // Bar 7 is checked on beat 4.5, but bar 6 would go to beat 5.
    const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 11, (bar) => bar - 0.5), 7: 4.5, 12: 11 }, [1, 2, 3, 4, 7, 12])
    expect(regridLocators(doc, stretch(3, 11, 'between'), beats, 1).result).toEqual({ ok: false, reason: 'out-of-range' })
  })

  it('refuses when every line is on its beat already', () => {
    const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 11, (bar) => bar - 1), 12: 11 }, [1, 2, 3, 4, 12])
    expect(regridLocators(doc, stretch(3, 11, 'between'), beats, 1).result).toEqual({ ok: false, reason: 'out-of-range' })
  })

  it('refuses when no bar lies between the lines', () => {
    const doc = pulseDoc({ ...onEveryBeat, 5: 11 }, [1, 2, 3, 4, 5])
    expect(regridLocators(doc, stretch(3, 11, 'between'), beats, 1).result).toEqual({ ok: false, reason: 'out-of-range' })
  })

  it('sets the lines of a stretch whose end line is played a second time', () => {
    // Bars 1 to 8, then 3 to 8 again: 14 slots. The end line is bar 6 on its second pass (slot 11), checked on beat 11.
    const doc = repeatDoc(REPEAT_BARS_3_TO_8, 8, (p) => (p <= 3 ? p : p <= 10 ? 3 + (p - 3) * 0.6 : p === 11 ? 11 : 30 + p - 12), [0, 1, 2, 3, 11])
    const outcome = regridLocators(doc, stretch(3, 11, 'between'), beats, 1)
    const result = ok(outcome.result)
    expect(outcome).toMatchObject({ placed: 7, removed: 0, spread: 0 })
    // slots 4 to 10: bars 5 to 8 on their first pass, then bars 3 to 5 on their second
    const slotsSet: [number, number][] = [[5, 0], [6, 0], [7, 0], [8, 0], [3, 1], [4, 1], [5, 1]]
    slotsSet.forEach(([bar, pass], index) => expect(lineOf(result.doc, bar, pass)!.timeSec, `bar ${bar} pass ${pass}`).toBeCloseTo(beatTime(4 + index), 3))
    // the end line (bar 6, pass 2) is where it was and still checked, and so is everything after it
    expect(lineOf(result.doc, 6, 1)).toEqual(lineOf(doc, 6, 1))
    expect(lineOf(result.doc, 7, 1)).toEqual(lineOf(doc, 7, 1))
    expect(lineOf(result.doc, 8, 1)).toEqual(lineOf(doc, 8, 1))
    expect(result.doc.timing.locators).toHaveLength(14)
    expectLabelsConsistent(result.doc)
  })

  describe('the plan of the same stretch', () => {
    it('lists the old guesses of the bars it gives a new time as deletes, beside the new places as adds', () => {
      const plan = planRegrid(betweenDoc(), stretch(3, 11, 'between'), beats, 1)
      expectTimes(plan.adds, rangeOf(4, 10).map(beatTime))
      expect(plan.deletes).toEqual(rangeOf(5, 11).map((bar) => ({ bar, passIndex: 0 })))
    })

    it('counts as removed only the lines that end with no time', () => {
      expect(regridLocators(betweenDoc(), stretch(3, 11, 'between'), beats, 1)).toMatchObject({ placed: 7, removed: 0 })
      // no end line: bars 5 to 12 are given new times, bars 13 to 20 go
      const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 20, (bar) => 3 + (bar - 4) * 0.5) }, [1, 2, 3, 4])
      expect(planRegrid(doc, stretch(3, 12, 'between'), beats, 1).deletes).toEqual(rangeOf(5, 20).map((bar) => ({ bar, passIndex: 0 })))
      expect(regridLocators(doc, stretch(3, 12, 'between'), beats, 1)).toMatchObject({ placed: 8, removed: 8 })
    })

    it('leaves a checked line and a guess that is on its beat out of the deletes', () => {
      // Bar 8 is checked; bar 6 is on beat 5 already.
      const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 11, (bar) => bar - 0.5), 6: 5, 8: 7.3, 12: 11 }, [1, 2, 3, 4, 8, 12])
      const plan = planRegrid(doc, stretch(3, 11, 'between'), beats, 1)
      expect(plan.deletes.map((d) => d.bar)).toEqual([5, 7, 9, 10, 11])
      expect(plan.adds).toHaveLength(5)
    })

    it('has no deletes when every line is on its beat already', () => {
      const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 11, (bar) => bar - 1), 12: 11 }, [1, 2, 3, 4, 12])
      expect(planRegrid(doc, stretch(3, 11, 'between'), beats, 1)).toMatchObject({ adds: [], deletes: [] })
    })
  })
})

describe('planContinueOrWhy', () => {
  const continueDoc = (): EditorDoc =>
    pulseDoc({ ...onEveryBeat, ...guesses(5, 11, (bar) => bar - 0.5), 12: 11, ...guesses(13, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4, 12])

  it('gives the plan and no reason when Continue has a run to go on from', () => {
    const result = planContinueOrWhy(continueDoc(), beats, DURATION_SEC)
    expect(result.off).toBeNull()
    expect(result.plan).toEqual(planContinue(continueDoc(), beats, DURATION_SEC))
    expect(result.plan?.beatsPerBar).toBe(1)
  })

  it('says there is no run when fewer than four lines are checked in a row, or a guess or a missing bar breaks the run', () => {
    const three = pulseDoc({ 1: 0, 2: 1, 3: 2, ...guesses(4, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3])
    const broken = pulseDoc({ 1: 0, 2: 1, 3: 2, 4: 3.5, 5: 4, ...guesses(6, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 5])
    const gap = pulseDoc({ 1: 0, 2: 1, 3: 2, 5: 4, ...guesses(6, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 5])
    for (const doc of [three, broken, gap]) expect(planContinueOrWhy(doc, beats, DURATION_SEC)).toEqual({ plan: null, off: 'no-run' })
  })

  it('says there is no run when the run ends on the last bar of the piece, or when `from` is not the end of one', () => {
    const last = pulseDoc({ ...guesses(1, 16, (bar) => 3 * (bar - 1)), ...guesses(17, 20, (bar) => 46 + bar - 17) }, [17, 18, 19, 20])
    expect(planContinueOrWhy(last, beats, DURATION_SEC).off).toBe('no-run')
    expect(planContinueOrWhy(continueDoc(), beats, DURATION_SEC, { bar: 2, passIndex: 0 }).off).toBe('no-run')
    expect(planContinueOrWhy(continueDoc(), beats, DURATION_SEC, { bar: 99, passIndex: 0 }).off).toBe('no-run')
  })

  it('says the bars are not steady when four checked lines do not agree on how many beats a bar holds', () => {
    // Beats 0, 1, 3, 4: one beat, two beats, one beat.
    const doc = pulseDoc({ 1: 0, 2: 1, 3: 3, 4: 4, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4])
    expect(planContinueOrWhy(doc, beats, DURATION_SEC)).toEqual({ plan: null, off: 'not-steady' })
  })

  it('says the bars are not steady when a checked line is more than 0.1 s from a beat', () => {
    // The last line is 0.3 of a beat (0.25 s) after beat 3.
    const doc = pulseDoc({ 1: 0, 2: 1, 3: 2, 4: 3.3, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4])
    expect(planContinueOrWhy(doc, beats, DURATION_SEC)).toEqual({ plan: null, off: 'not-steady' })
  })

  it('says there is no room when the recording ends at the last checked line and no checked line follows', () => {
    const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4])
    expect(planContinueOrWhy(doc, beats, beatTime(3))).toEqual({ plan: null, off: 'no-room' })
  })

  it('agrees with planContinue: its plan, or null', () => {
    const doc = pulseDoc({ 1: 0, 2: 1, 3: 3, 4: 4, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4])
    expect(planContinue(doc, beats, DURATION_SEC)).toBeNull()
    expect(planContinue(continueDoc(), beats, DURATION_SEC)).toEqual(planContinueOrWhy(continueDoc(), beats, DURATION_SEC).plan)
  })
})

describe('planContinue', () => {
  const continueDoc = (): EditorDoc =>
    pulseDoc({ ...onEveryBeat, ...guesses(5, 11, (bar) => bar - 0.5), 12: 11, ...guesses(13, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4, 12])

  it('learns one beat a bar from bars 1 to 4 on every beat and continues from bar 4 to the next checked line', () => {
    const doc = continueDoc()
    const plan = planContinue(doc, beats, DURATION_SEC)!
    expect(plan).not.toBeNull()
    expect(plan.beatsPerBar).toBe(1)
    expect(plan.offsetSec).toBeCloseTo(0, 6)
    expect(plan.stretch.fit).toBe('between')
    expect(plan.stretch.fromSec).toBeCloseTo(beatTime(3), 6)
    expect(plan.stretch.toSec).toBeCloseTo(beatTime(11), 6)
    expect(plan.firstBar).toBe(1)
    expect(plan.lastBar).toBe(4)
    expect(plan.lastPassIndex).toBe(0)
    expect(plan.learnedTimes).toHaveLength(4)
    plan.learnedTimes.forEach((time, index) => expect(time).toBeCloseTo(beatTime(index), 6))
    expect(plan.plan.beatsPerBar).toBe(1)
    expect(plan.plan.adds).toHaveLength(7)
    expect(plan.plan.deletes).toEqual(rangeOf(5, 11).map((bar) => ({ bar, passIndex: 0 })))
    expect(plan.plan).toEqual(planRegrid(doc, plan.stretch, beats, plan.beatsPerBar, plan.offsetSec))
  })

  it('names the bar of the end line as the bar it continues to', () => {
    expect(planContinue(continueDoc(), beats, DURATION_SEC)!.endBar).toBe(12)
  })

  it('ends at the end of the recording when no checked line follows', () => {
    const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4])
    const plan = planContinue(doc, beats, DURATION_SEC)!
    expect(plan.stretch).toEqual({ fromSec: beatTime(3), toSec: DURATION_SEC, fit: 'between' })
    // the recording has beats for every bar left, so the last bar is where it stops
    expect(plan.endBar).toBe(20)
  })

  it('names the last bar the beats reach as the bar it continues to when there is no end line', () => {
    // The recording ends on beat 12: beats 3 to 11 are 9 lines from bar 4 on, so bar 12 is the last one reached.
    const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4])
    const plan = planContinue(doc, beats, beatTime(12))!
    expect(plan.stretch.toSec).toBe(beatTime(12))
    expect(plan.endBar).toBe(12)
  })

  it('counts bars with no line yet as what follows the run', () => {
    const plan = planContinue(pulseDoc(onEveryBeat, [1, 2, 3, 4]), beats, DURATION_SEC)!
    expect(plan.stretch.fromSec).toBeCloseTo(beatTime(3), 6)
    // beats 4 to 19 get the lines of bars 5 to 20
    expect(plan.plan.adds).toHaveLength(16)
    expect(plan.endBar).toBe(20)
  })

  it('gives null when a guess breaks the run: three checked bars, a guess, a checked bar', () => {
    const doc = pulseDoc({ 1: 0, 2: 1, 3: 2, 4: 3.5, 5: 4, ...guesses(6, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 5])
    expect(planContinue(doc, beats, DURATION_SEC)).toBeNull()
  })

  it('goes on from an earlier full run when a guess cuts the later one short', () => {
    // Bars 1 to 4 are checked; bar 5 is a guess; bars 6 to 8 are checked, but three is not enough to learn from.
    const doc = pulseDoc({ ...onEveryBeat, 5: 4.5, 6: 5, 7: 6, 8: 7, ...guesses(9, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4, 6, 7, 8])
    const plan = planContinue(doc, beats, DURATION_SEC)!
    expect(plan.stretch).toEqual({ fromSec: beatTime(3), toSec: beatTime(5), fit: 'between' })
    expect([plan.firstBar, plan.lastBar, plan.endBar]).toEqual([1, 4, 6])
  })

  it('continues to an end line that is played a second time, and puts the lines on the bars of both passes', () => {
    // Bars 1 to 8, then 3 to 8 again (14 slots); the end line is bar 6 on its second pass, checked on beat 11.
    const doc = repeatDoc(REPEAT_BARS_3_TO_8, 8, (p) => (p <= 3 ? p : p <= 10 ? 3 + (p - 3) * 0.6 : p === 11 ? 11 : 30 + p - 12), [0, 1, 2, 3, 11])
    const plan = planContinue(doc, beats, DURATION_SEC)!
    expect(plan.stretch).toEqual({ fromSec: beatTime(3), toSec: beatTime(11), fit: 'between' })
    expect([plan.firstBar, plan.lastBar, plan.endBar]).toEqual([1, 4, 6])
    expect(plan.plan.adds).toHaveLength(7)
    const result = ok(regridLocators(doc, plan.stretch, beats, plan.beatsPerBar, plan.offsetSec).result)
    expect(result.doc.timing.locators.map((l) => l.timeSec)).toEqual([...result.doc.timing.locators.map((l) => l.timeSec)].sort((a, b) => a - b))
    expect(lineOf(result.doc, 5, 1)!.timeSec).toBeCloseTo(beatTime(10), 3)
    expect(lineOf(result.doc, 6, 1)).toEqual(lineOf(doc, 6, 1))
    expectLabelsConsistent(result.doc)
  })

  it('gives null when the checked bars do not agree on how many beats a bar holds', () => {
    // Beats 0, 1, 3, 4: one beat, two beats, one beat.
    expect(planContinue(pulseDoc({ 1: 0, 2: 1, 3: 3, 4: 4, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4]), beats, DURATION_SEC)).toBeNull()
  })

  it('gives null for three checked bars in a row', () => {
    expect(planContinue(pulseDoc({ 1: 0, 2: 1, 3: 2, ...guesses(4, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3]), beats, DURATION_SEC)).toBeNull()
  })

  it('gives null when the checked bars are not in a row: a bar with no line breaks the run', () => {
    expect(planContinue(pulseDoc({ 1: 0, 2: 1, 3: 2, 5: 4, ...guesses(6, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 5]), beats, DURATION_SEC)).toBeNull()
  })

  it('gives null when the run ends on the last bar of the piece: nothing follows to continue on', () => {
    const doc = pulseDoc({ ...guesses(1, 16, (bar) => 3 * (bar - 1)), ...guesses(17, 20, (bar) => 46 + bar - 17) }, [17, 18, 19, 20])
    expect(planContinue(doc, beats, DURATION_SEC)).toBeNull()
  })

  it('gives null without beats', () => {
    expect(planContinue(continueDoc(), [], DURATION_SEC)).toBeNull()
  })

  it('takes the latest run, and the run ending at `from` when one is given', () => {
    const doc = pulseDoc(
      { ...onEveryBeat, ...guesses(5, 8, (bar) => 4 + (bar - 5) * 4), 9: 20, 10: 21, 11: 22, 12: 23, ...guesses(13, 20, (bar) => 3 * (bar - 1)) },
      [1, 2, 3, 4, 9, 10, 11, 12],
    )
    const latest = planContinue(doc, beats, DURATION_SEC)!
    expect(latest.stretch).toEqual({ fromSec: beatTime(23), toSec: DURATION_SEC, fit: 'between' })
    expect([latest.firstBar, latest.lastBar]).toEqual([9, 12])
    const earlier = planContinue(doc, beats, DURATION_SEC, { bar: 4, passIndex: 0 })!
    expect(earlier.stretch).toEqual({ fromSec: beatTime(3), toSec: beatTime(20), fit: 'between' })
    expect([earlier.firstBar, earlier.lastBar]).toEqual([1, 4])
  })

  it('gives null when `from` is not the end of a run', () => {
    const doc = continueDoc()
    expect(planContinue(doc, beats, DURATION_SEC, { bar: 2, passIndex: 0 })).toBeNull() // in the middle of the run
    expect(planContinue(doc, beats, DURATION_SEC, { bar: 5, passIndex: 0 })).toBeNull() // a guess
    expect(planContinue(doc, beats, DURATION_SEC, { bar: 99, passIndex: 0 })).toBeNull() // no such bar
  })

  it('names the pass of the last line of the run, so a run that ends on a repeat is told from the same bar the first time', () => {
    // Slots 6 to 9 are bar 7 and 8 the first time, then bars 3 and 4 the second; slot 2, bar 4 the first time, is a different line.
    const doc = repeatDoc(REPEAT_BARS_3_TO_8, 8, (p) => (p <= 9 ? p : 3 * p), [6, 7, 8, 9])
    const plan = planContinue(doc, beats, DURATION_SEC)!
    expect([plan.firstBar, plan.lastBar, plan.lastPassIndex]).toEqual([7, 4, 1])
  })

  it('learns from the last four lines of a longer run', () => {
    // Bars 1 and 2 are three beats apart; bars 3 to 6 are one beat apart: all six are checked, in a row.
    const doc = pulseDoc({ 1: 0, 2: 3, 3: 6, 4: 7, 5: 8, 6: 9, ...guesses(7, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4, 5, 6])
    const plan = planContinue(doc, beats, DURATION_SEC)!
    expect(plan.beatsPerBar).toBe(1)
    expect([plan.firstBar, plan.lastBar]).toEqual([3, 6])
    expect(plan.learnedTimes).toHaveLength(4)
    plan.learnedTimes.forEach((time, index) => expect(time).toBeCloseTo(beatTime(6 + index), 6))
    expect(plan.stretch.fromSec).toBeCloseTo(beatTime(9), 6)
  })

  it('carries the offset of the checked lines into the plan', () => {
    const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4], {}, 0.03)
    const plan = planContinue(doc, beats, DURATION_SEC)!
    expect(plan.offsetSec).toBeCloseTo(0.03, 6)
    expect(plan.stretch.fromSec).toBeCloseTo(beatTime(3) + 0.03, 6)
    expect(plan.plan.targets[1]).toBeCloseTo(beatTime(4) + 0.03, 6)
  })
})

// Bars of other meters. N is the beats the tracker hears in one bar of the reference meter (the meter of the stretch's
// start bar; for Continue, of the learned bars). A bar of another meter spans N x felt(its meter) / felt(reference) beats.
describe('bars of other meters', () => {
  const meter = (fromBar: number, numerator: number, denominator: number): MeterChange => ({ fromBar, numerator, denominator })
  /** 3/4 for bars 1 to 4, 2/4 from bar 5 on. */
  const THREE_THEN_TWO = [meter(1, 3, 4), meter(5, 2, 4)]
  /** The beat of bar `bar` when bars 1 to 4 hold 3 beats each and the 2/4 bars from bar 5 hold 2. */
  const threeThenTwoBeat = (bar: number): number => (bar <= 5 ? 3 * (bar - 1) : 12 + 2 * (bar - 5))
  const rangeBeats = (from: number, to: number, step: number): number[] => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step)

  describe('five and six beats a bar', () => {
    const fiveFour = { meters: [meter(1, 5, 4)] }

    it('puts a target on every 5th beat for five beats a bar, in a piece in 5/4', () => {
      const plan = planRegrid(pulseDoc(everyNth(3), [], fiveFour), stretch(0, 57), beats, 5)
      expect(plan.beatsPerBar).toBe(5)
      expectTimes(plan.targets, rangeOf(0, 11).map((i) => beatTime(5 * i)))
    })

    it('puts a target on every 6th beat for six', () => {
      const plan = planRegrid(pulseDoc(everyNth(3), [], fiveFour), stretch(0, 57), beats, 6)
      expectTimes(plan.targets, rangeOf(0, 9).map((i) => beatTime(6 * i)))
    })

    it('regrids a 5/4 piece to five beats a bar, the lines on the beats', () => {
      const doc = pulseDoc(everyNth(3), [], fiveFour)
      const result = ok(regridLocators(doc, stretch(0, 57), beats, 5).result)
      expectOnBeats(result.doc, Object.fromEntries(rangeOf(1, 12).map((bar) => [bar, 5 * (bar - 1)])))
      expect(result.doc.timing.locators.every((l) => !l.confirmed)).toBe(true)
    })
  })

  describe('a stretch that crosses a meter change', () => {
    it('gives a 2/4 bar two thirds of a beat at one beat a bar in 3/4, and the bars after it stay on that share', () => {
      const plan = planRegrid(pulseDoc(onEveryBeat, [], { meters: THREE_THEN_TWO }), whole, beats, 1)
      // bars 1 to 4: beats 0 to 3; bar 5 begins at beat 4 and each 2/4 bar after it is 2/3 of a beat
      const expected = [0, 1, 2, 3, ...rangeOf(0, 15).map((k) => 4 + (2 * k) / 3)]
      expectTimes(plan.targets, expected.map(beatTime))
    })

    it('lands a 3/4 then 2/4 piece on its beats at three beats a bar: 3 beats, then 2', () => {
      const plan = planRegrid(pulseDoc(everyNth(3), [], { meters: THREE_THEN_TWO }), whole, beats, 3)
      expectTimes(plan.targets, rangeOf(1, 20).map(threeThenTwoBeat).filter((beat) => beat < BEAT_COUNT).map(beatTime))
    })

    it('puts the lines of that piece on the beats when it is applied', () => {
      const doc = pulseDoc(everyNth(3), [], { meters: THREE_THEN_TWO })
      const result = ok(regridLocators(doc, whole, beats, 3).result)
      expectOnBeats(result.doc, Object.fromEntries(rangeOf(1, 20).map((bar) => [bar, threeThenTwoBeat(bar)])))
      expectLabelsConsistent(result.doc)
    })

    it('doubles the share for six beats a bar: a 2/4 bar is four beats', () => {
      const plan = planRegrid(pulseDoc(onEveryBeat, [], { meters: THREE_THEN_TWO }), whole, beats, 6)
      expectTimes(plan.targets.slice(0, 7), [0, 6, 12, 18, 24, 28, 32].map(beatTime))
    })

    it('counts the beats of a bar of another meter from the start bar when the stretch begins in the second meter', () => {
      // from bar 6 (a 2/4 bar), at one beat a bar: every 2/4 bar is one beat, not two thirds of one
      const doc = pulseDoc(Object.fromEntries(rangeOf(1, 20).map((bar) => [bar, threeThenTwoBeat(bar)])), [], { meters: THREE_THEN_TWO })
      const plan = planRegrid(doc, stretch(threeThenTwoBeat(6), 30), beats, 1)
      // the 15 bars from bar 6 to bar 20 get a beat each
      expectTimes(plan.targets, rangeOf(14, 28).map(beatTime))
    })

    it('goes back to the share of the first meter when a bar is in it again: 6/8 then 9/8 then 6/8, two beats a bar', () => {
      const meters = [meter(1, 6, 8), meter(4, 9, 8), meter(6, 6, 8)]
      const plan = planRegrid(pulseDoc(everyNth(3), [], { meters }), whole, beats, 2)
      // bars 1 to 3: 2 beats; bars 4 and 5 (9/8): 3 beats; bars 6 on: 2 beats
      expectTimes(plan.targets, [0, 2, 4, 6, 9, 12, ...rangeBeats(14, 40, 2)].map(beatTime))
    })

    it('takes the share of a pickup from the reference as well as the meter', () => {
      // A one-beat pickup (bar 0, 1/3 of a 3/4 bar) then 3/4 bars 1 to 4 and 2/4 from bar 5, at three beats a bar
      const doc = pulseDoc({ 0: 0 }, [], { playOrder: [{ from: 0, to: BAR_COUNT }], meters: THREE_THEN_TWO, shortBars: [{ bar: 0, units: 1 }] })
      const plan = planRegrid(doc, whole, beats, 3)
      expectTimes(plan.targets.slice(0, 8), [0, 1, 4, 7, 10, 13, 15, 17].map(beatTime))
    })
  })

  describe('a stretch inside one meter of a piece that changes it', () => {
    const doc = () => pulseDoc(Object.fromEntries(rangeOf(1, 20).map((bar) => [bar, threeThenTwoBeat(bar)])), [], { meters: THREE_THEN_TWO })

    it('keeps the 3 beats of 3/4 bars that end before the change', () => {
      // from bar 2 to the line of bar 5 (beat 12) at three beats a bar: the lines of bars 2 to 4 are already on beats 3, 6, 9
      const plan = planRegrid(doc(), stretch(3, 12), beats, 3)
      expectTimes(plan.targets, [3, 6, 9].map(beatTime))
      expect(plan).toMatchObject({ adds: [], deletes: [] })
    })

    it('puts a 3/4 stretch at one beat a bar by the first meter alone while its bars stay inside it', () => {
      const plan = planRegrid(doc(), stretch(3, 6), beats, 1)
      expectTimes(plan.targets.slice(0, 3), [3, 4, 5].map(beatTime))
    })

    it('leaves the lines before the stretch alone', () => {
      const result = ok(regridLocators(doc(), stretch(threeThenTwoBeat(7), 40), beats, 1).result)
      expectUnchanged(result.doc, doc(), rangeOf(1, 7))
    })
  })

  // A bar of another meter spans an exact share of the beats: 0.75 of a beat is not a beat, though it is near one.
  describe('the share of a bar of another meter is not snapped to a whole beat', () => {
    const fourFourThen = (numerator: number, denominator: number): MeterChange[] => [meter(1, 4, 4), meter(3, numerator, denominator)]
    /** Bars 1 and 2 on beats 0 and 1, bar 3 on beat 2, then every bar `step` beats on from there. */
    const stepsOf = (step: number): number[] => [0, 1, 2, ...rangeOf(1, 17).map((k) => 2 + step * k)]
    const targetsAt = (meters: MeterChange[], n: 1 | 3): number[] => planRegrid(pulseDoc(everyNth(3), [], { meters }), whole, beats, n).targets

    it('4/4 then 3/4 at one beat a bar: 0, 1, 2, 2.75, 3.5, 4.25, 5', () => {
      const targets = targetsAt(fourFourThen(3, 4), 1)
      expectTimes(targets.slice(0, 7), [0, 1, 2, 2.75, 3.5, 4.25, 5].map(beatTime))
      expectTimes(targets, stepsOf(0.75).map(beatTime))
    })

    it('12/8 then 9/8 at one beat a bar: the same, 3 of the 4 felt beats', () => {
      const meters = [meter(1, 12, 8), meter(3, 9, 8)]
      expectTimes(targetsAt(meters, 1), stepsOf(0.75).map(beatTime))
    })

    it('4/4 then 5/4 at one beat a bar: 1.25 beats a bar from bar 3', () => {
      const meters = [meter(1, 4, 4), meter(3, 5, 4)]
      expectTimes(targetsAt(meters, 1), stepsOf(1.25).map(beatTime))
    })

    it('5/4 then 4/4 at one beat a bar: 0.8 of a beat a bar from bar 3', () => {
      const meters = [meter(1, 5, 4), meter(3, 4, 4)]
      expectTimes(targetsAt(meters, 1), stepsOf(0.8).map(beatTime))
    })

    it('a 3/4 bar in a 4/4 stretch at three beats a bar: 2.25 beats, not 2', () => {
      const meters = [meter(1, 4, 4), meter(3, 3, 4)]
      expectTimes(targetsAt(meters, 3), [0, 3, ...rangeOf(0, 17).map((k) => 6 + 2.25 * k)].map(beatTime))
    })

    // Back in the reference meter after bars of another one: the whole bars go on from where the exact ones left the lines.
    describe('and back in the first meter', () => {
      const targetsBack = (meters: MeterChange[], n: 1 | 3, extra: Partial<TimingLayer> = {}): number[] =>
        planRegrid(pulseDoc(everyNth(3), [], { meters, ...extra }), whole, beats, n).targets
      const shortened = [meter(1, 4, 4), meter(3, 3, 4), meter(4, 4, 4)]

      it('4/4, one 3/4 bar, 4/4: 2.75, 3.75, 4.75 ... not 2.75, 4, 5', () => {
        expectTimes(targetsBack(shortened, 1), [0, 1, 2, 2.75, ...rangeOf(0, 15).map((k) => 3.75 + k)].map(beatTime))
      })

      it('4/4, three 3/4 bars, 4/4: 4.25, 5.25, 6.25 ...', () => {
        const meters = [meter(1, 4, 4), meter(3, 3, 4), meter(6, 4, 4)]
        expectTimes(targetsBack(meters, 1), [0, 1, 2, 2.75, 3.5, 4.25, ...rangeOf(1, 14).map((k) => 4.25 + k)].map(beatTime))
      })

      it('4/4, one 5/4 bar, 4/4: 3.25, 4.25, 5.25 ...', () => {
        const meters = [meter(1, 4, 4), meter(3, 5, 4), meter(4, 4, 4)]
        expectTimes(targetsBack(meters, 1), [0, 1, 2, 3.25, ...rangeOf(1, 16).map((k) => 3.25 + k)].map(beatTime))
      })

      it('5/4, one 4/4 bar, 5/4: 1.8, 2.8, 3.8 ...', () => {
        const meters = [meter(1, 5, 4), meter(2, 4, 4), meter(3, 5, 4)]
        expectTimes(targetsBack(meters, 1), [0, 1, 1.8, ...rangeOf(1, 17).map((k) => 1.8 + k)].map(beatTime))
      })

      it('12/8, one 9/8 bar, 12/8: 2.75, 3.75, 4.75 ...', () => {
        const meters = [meter(1, 12, 8), meter(3, 9, 8), meter(4, 12, 8)]
        expectTimes(targetsBack(meters, 1), [0, 1, 2, 2.75, ...rangeOf(0, 15).map((k) => 3.75 + k)].map(beatTime))
      })

      it('4/4, one 3/4 bar, 4/4 at three beats a bar: 8.25, 11.25, 14.25 ...', () => {
        expectTimes(targetsBack(shortened, 3), [0, 3, 6, 8.25, ...rangeOf(0, 15).map((k) => 11.25 + 3 * k)].map(beatTime))
      })

      it('puts the lines of the first case where they are exact, when it is applied', () => {
        const result = ok(regridLocators(pulseDoc(everyNth(3), [], { meters: shortened }), whole, beats, 1).result)
        expectOnBeats(result.doc, { 1: 0, 2: 1, 3: 2, 4: 2.75, 5: 3.75, 6: 4.75, 7: 5.75 })
      })

      it('keeps snapping a short bar inside the stretch, to the beats as the exact bar shifted them', () => {
        // 5/4 with one 4/4 bar, then bar 3 holds 4 of its 5 beats (0.8 of a bar): 1.8 + 0.8 = 2.6 lands on 2.8, and the bars after stay on that shift
        const meters = [meter(1, 5, 4), meter(2, 4, 4), meter(3, 5, 4)]
        expectTimes(targetsBack(meters, 1, { shortBars: [{ bar: 3, units: 4 }] }), [0, 1, 1.8, ...rangeOf(1, 17).map((k) => 1.8 + k)].map(beatTime))
      })
    })

    it('still lands a bar of another meter on a beat when its share is a whole number of them', () => {
      expectTimes(targetsAt([meter(1, 3, 4), meter(3, 2, 4)], 3), [0, 3, ...rangeOf(0, 17).map((k) => 6 + 2 * k)].map(beatTime))
    })

    it('puts the lines of a 4/4 then 3/4 piece at one beat a bar where they are exact, when it is applied', () => {
      const doc = pulseDoc(everyNth(3), [], { meters: fourFourThen(3, 4) })
      const result = ok(regridLocators(doc, whole, beats, 1).result)
      expectOnBeats(result.doc, { 1: 0, 2: 1, 3: 2, 4: 2.75, 5: 3.5, 6: 4.25, 7: 5 })
    })
  })

  it('counts N in the reference meter it is given, not the start bar\'s: 2/4 bars at two beats a bar of 4/4 are one beat each', () => {
    const doc = pulseDoc(everyNth(3), [], { meters: [meter(1, 2, 4)] })
    const plan = planRegrid(doc, whole, beats, 2, 0, { numerator: 4, denominator: 4 })
    expectTimes(plan.targets, rangeOf(0, 19).map(beatTime))
    // given nothing, the start bar's own meter is the reference
    expectTimes(planRegrid(doc, whole, beats, 2).targets.slice(0, 3), [0, 2, 4].map(beatTime))
  })

  describe('Continue', () => {
    it('goes on across a meter change by the share of each bar: 3 beats in 3/4, then 2 in 2/4', () => {
      // bars 1 to 4 checked on beats 0, 3, 6, 9 in 3/4; the piece changes to 2/4 at bar 7
      const meters = [meter(1, 3, 4), meter(7, 2, 4)]
      const doc = pulseDoc({ 1: 0, 2: 3, 3: 6, 4: 9, ...guesses(5, 20, (bar) => 3 * (bar - 1) + 1) }, [1, 2, 3, 4], { meters })
      const plan = planContinue(doc, beats, DURATION_SEC)!
      expect(plan.beatsPerBar).toBe(3)
      // bar 4 at 9, bars 5, 6, 7 at 12, 15, 18, then 2/4 bars: 20, 22, 24
      expectTimes(plan.plan.targets.slice(0, 8), [9, 12, 15, 18, 20, 22, 24, 26].map(beatTime))
    })

    it('puts those lines on the bars it continues to', () => {
      const meters = [meter(1, 3, 4), meter(7, 2, 4)]
      const doc = pulseDoc({ 1: 0, 2: 3, 3: 6, 4: 9, ...guesses(5, 20, (bar) => 3 * (bar - 1) + 1) }, [1, 2, 3, 4], { meters })
      const plan = planContinue(doc, beats, DURATION_SEC)!
      const result = ok(regridLocators(doc, plan.stretch, beats, plan.beatsPerBar, plan.offsetSec).result)
      expectOnBeats(result.doc, { 5: 12, 6: 15, 7: 18, 8: 20, 9: 22, 10: 24 })
      expectUnchanged(result.doc, doc, [1, 2, 3, 4])
    })

    it('learns five beats a bar from four checked bars in 5/4', () => {
      const doc = pulseDoc({ 1: 0, 2: 5, 3: 10, 4: 15, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4], { meters: [meter(1, 5, 4)] })
      const plan = planContinue(doc, beats, DURATION_SEC)!
      expect(plan.beatsPerBar).toBe(5)
      expectTimes(plan.plan.targets.slice(0, 4), [15, 20, 25, 30].map(beatTime))
    })

    it('learns six beats a bar', () => {
      const doc = pulseDoc({ 1: 0, 2: 6, 3: 12, 4: 18, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4])
      expect(planContinue(doc, beats, DURATION_SEC)!.beatsPerBar).toBe(6)
    })

    it('learns from the last bars of one meter when the run crosses a change, and keeps that meter as the reference', () => {
      // bars 1 and 2 in 3/4, bars 3 to 6 in 2/4, back to 3/4 at bar 9; the lines are 2 beats apart all through
      const meters = [meter(1, 3, 4), meter(3, 2, 4), meter(9, 3, 4)]
      const doc = pulseDoc({ 1: 0, 2: 2, 3: 4, 4: 6, 5: 8, 6: 10, ...guesses(7, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4, 5, 6], { meters })
      const plan = planContinue(doc, beats, DURATION_SEC)!
      expect(plan.beatsPerBar).toBe(2)
      expect([plan.firstBar, plan.lastBar]).toEqual([3, 6])
      expect(plan.learnedTimes).toHaveLength(4)
      // bars 6 to 8 in 2/4 take 2 beats, bar 9 (3/4) takes 3
      expectTimes(plan.plan.targets.slice(0, 5), [10, 12, 14, 16, 19].map(beatTime))
    })

    it('gives null when fewer than four checked lines are in the last meter of a run that crosses a change', () => {
      // the same lines, the change at bar 4: bars 4 to 6 are three lines in 2/4 and the three before are in 3/4
      const meters = [meter(1, 3, 4), meter(4, 2, 4)]
      const doc = pulseDoc({ 1: 0, 2: 2, 3: 4, 4: 6, 5: 8, 6: 10, ...guesses(7, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4, 5, 6], { meters })
      expect(planContinue(doc, beats, DURATION_SEC)).toBeNull()
    })

    // Continue learns from the 3 bars between the 4 checked lines. The bar the 4th line starts is not one of them, so its meter does not matter.
    describe('when the bar of the last checked line is in another meter than the bars before it', () => {
      const meters = [meter(1, 3, 4), meter(4, 2, 4)]
      const doc = () => pulseDoc({ 1: 0, 2: 3, 3: 6, 4: 9, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4], { meters })

      it('learns three beats a bar from bars 1 to 3 and names the meter they are in as the reference', () => {
        const plan = planContinue(doc(), beats, DURATION_SEC)!
        expect(plan).toMatchObject({ beatsPerBar: 3, firstBar: 1, lastBar: 4, referenceMeter: { numerator: 3, denominator: 4 } })
      })

      it('goes on from bar 4 with 2 beats a bar: a 2/4 bar is 2/3 of the three beats of 3/4', () => {
        const plan = planContinue(doc(), beats, DURATION_SEC)!
        expectTimes(plan.plan.targets.slice(0, 5), [9, 11, 13, 15, 17].map(beatTime))
      })

      it('puts those lines on the bars when it is applied with the reference the plan names, and keeps the checked bars', () => {
        const plan = planContinue(doc(), beats, DURATION_SEC)!
        const result = ok(regridLocators(doc(), plan.stretch, beats, plan.beatsPerBar, plan.offsetSec, plan.referenceMeter).result)
        expectOnBeats(result.doc, { 5: 11, 6: 13, 7: 15, 8: 17 })
        expectUnchanged(result.doc, doc(), [1, 2, 3, 4])
        expectLabelsConsistent(result.doc)
      })

      it('would put the 2/4 bars three beats apart if the start bar\'s meter were the reference: the reference has to be carried', () => {
        const plan = planContinue(doc(), beats, DURATION_SEC)!
        const withoutIt = planRegrid(doc(), plan.stretch, beats, plan.beatsPerBar, plan.offsetSec)
        expectTimes(withoutIt.targets.slice(0, 3), [9, 12, 15].map(beatTime))
      })

      it('plans the same lines as planRegrid with that reference', () => {
        const plan = planContinue(doc(), beats, DURATION_SEC)!
        expect(plan.plan).toEqual(planRegrid(doc(), plan.stretch, beats, plan.beatsPerBar, plan.offsetSec, plan.referenceMeter))
      })
    })

    it('goes on into a longer bar the same way: two beats a bar in 2/4, then a 3/4 bar of three', () => {
      const meters = [meter(1, 2, 4), meter(4, 3, 4)]
      const doc = pulseDoc({ 1: 0, 2: 2, 3: 4, 4: 6, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4], { meters })
      const plan = planContinue(doc, beats, DURATION_SEC)!
      expect(plan).toMatchObject({ beatsPerBar: 2, referenceMeter: { numerator: 2, denominator: 4 } })
      expectTimes(plan.plan.targets.slice(0, 4), [6, 9, 12, 15].map(beatTime))
    })

    it('names the meter of a piece that keeps one as the reference', () => {
      const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4])
      expect(planContinue(doc, beats, DURATION_SEC)!.referenceMeter).toEqual({ numerator: 3, denominator: 4 })
    })

    it('does not change what a piece in one meter learns', () => {
      const doc = pulseDoc({ ...onEveryBeat, ...guesses(5, 20, (bar) => 3 * (bar - 1)) }, [1, 2, 3, 4])
      expect(planContinue(doc, beats, DURATION_SEC)).toMatchObject({ beatsPerBar: 1, firstBar: 1, lastBar: 4 })
    })
  })
})
