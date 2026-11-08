import { expandPlayOrder } from '@/domain/playOrder'
import { type Locator, type ReviewFlag, type TimingLayer } from '@/domain/types'
import { fakeFill, fakeRealign } from '@/lib/fakes/fakeRealign'
import { DEMO_SPEC, recordingSeconds, syntheticTiming } from '@/lib/fakes/syntheticPiece'

const END = recordingSeconds(DEMO_SPEC)

/** The demo timing with every unconfirmed locator pushed off its time, as a bad old fit would leave them. */
function scrambled(): TimingLayer {
  const timing = syntheticTiming(DEMO_SPEC)
  timing.locators = timing.locators.map((locator) =>
    locator.confirmed ? locator : { ...locator, timeSec: locator.timeSec + 3.3 },
  )
  return timing
}

function simple(locators: Locator[], barCount = 8): TimingLayer {
  return {
    barCount,
    playOrder: [{ from: 1, to: barCount }],
    meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
    marks: [],
    locators,
  }
}

/** The times of the locators, to 9 decimals: the refit divides, so exact decimals are not promised. */
const timesOf = (timing: TimingLayer) => timing.locators.map((locator) => Math.round(locator.timeSec * 1e9) / 1e9)

const loc = (bar: number, timeSec: number, confirmed = false): Locator => ({ bar, passIndex: 0, timeSec, confirmed })

describe('fakeRealign', () => {
  it('returns the confirmed locators unchanged: same time, still confirmed', () => {
    const before = scrambled()

    const after = fakeRealign(before, END)

    for (const locator of before.locators.filter((candidate) => candidate.confirmed)) {
      expect(after.locators).toContainEqual(locator)
    }
  })

  it('gives every slot of the play order exactly one locator, strictly increasing in time', () => {
    const after = fakeRealign(scrambled(), END)
    const slots = expandPlayOrder(after.playOrder, after.barCount)

    expect(after.locators.map((locator) => [locator.bar, locator.passIndex])).toEqual(
      slots.map((slot) => [slot.bar, slot.passIndex]),
    )
    after.locators.forEach((locator, i) => {
      if (i > 0) expect(locator.timeSec).toBeGreaterThan(after.locators[i - 1].timeSec)
    })
  })

  it('ignores the old times of unconfirmed locators', () => {
    const after = fakeRealign(scrambled(), END)

    // The demo piece is a steady tempo, so a refit by beats lands on the recorded times (between these anchors no fermata).
    const original = syntheticTiming(DEMO_SPEC)
    const slot = original.locators.findIndex((locator) => locator.bar === 12 && locator.passIndex === 0)
    expect(after.locators[slot].confirmed).toBe(false)
    expect(after.locators[slot].timeSec).toBeCloseTo(original.locators[slot].timeSec, 6)
  })

  it('does not change the structure of the timing and does not touch its input', () => {
    const before = scrambled()
    const copy = structuredClone(before)

    const after = fakeRealign(before, END)

    expect(before).toEqual(copy)
    expect({ ...after, locators: [] }).toEqual({ ...before, locators: [] })
    expect(after).not.toBe(before)
  })

  it('gives a locator to a slot added to the play order, between its neighbours', () => {
    const before = syntheticTiming(DEMO_SPEC)
    before.playOrder = [...before.playOrder, { from: 1, to: 2 }]

    const after = fakeRealign(before, END)

    expect(after.locators).toHaveLength(74)
    const added = after.locators.filter((locator) => locator.bar === 1 && locator.passIndex === 1)
    expect(added).toHaveLength(1)
    expect(added[0].timeSec).toBeGreaterThan(after.locators[71].timeSec)
    expect(added[0].confirmed).toBe(false)
  })

  it('drops the locator of a slot that no longer exists', () => {
    const before = syntheticTiming(DEMO_SPEC)
    before.playOrder = [{ from: 1, to: 16 }, { from: 17, to: 64 }]

    const after = fakeRealign(before, END)

    expect(after.locators).toHaveLength(64)
    expect(after.locators.some((locator) => locator.passIndex > 0)).toBe(false)
  })

  it('drops a confirmed locator whose slot is gone', () => {
    const before = simple([loc(1, 1, true), loc(4, 7, true), loc(8, 15, true)])
    before.barCount = 6
    before.playOrder = [{ from: 1, to: 6 }]

    const after = fakeRealign(before, 20)

    expect(after.locators).toHaveLength(6)
    expect(after.locators.some((locator) => locator.bar === 8)).toBe(false)
  })

  it('spreads the slots between two anchors evenly by beats', () => {
    // Bars 1 and 5 confirmed 8 s apart: four 4/4 bars between, 2 s each.
    const after = fakeRealign(simple([loc(1, 10, true), loc(5, 18, true)]), 40)

    expect(timesOf(after).slice(0, 5)).toEqual([10, 12, 14, 16, 18])
  })

  it('weights the spread by the meter: a 2/4 bar takes half the time', () => {
    const before = simple([loc(1, 10, true), loc(4, 19, true)], 4)
    before.meters = [
      { fromBar: 1, numerator: 4, denominator: 4 },
      { fromBar: 3, numerator: 2, denominator: 4 },
    ]

    const after = fakeRealign(before, 40)

    // 4 + 4 + 2 beats over 9 s: 0.9 s a beat.
    expect(timesOf(after)).toEqual([10, 13.6, 17.2, 19])
  })

  it('runs on before the first anchor and after the last at the local tempo, inside the recording', () => {
    const after = fakeRealign(simple([loc(3, 10, true), loc(5, 14, true)]), 30)

    // 2 s a bar between the anchors, and the same before and after them.
    expect(timesOf(after)).toEqual([6, 8, 10, 12, 14, 16, 18, 20])
  })

  it('keeps the slots before the first anchor above 0 and the slots after the last below the recording end', () => {
    const after = fakeRealign(simple([loc(3, 1, true), loc(5, 21, true)]), 30)
    const times = after.locators.map((locator) => locator.timeSec)

    expect(times[0]).toBeGreaterThan(0)
    expect(times[times.length - 1]).toBeLessThan(30)
    times.forEach((time, i) => {
      if (i > 0) expect(time).toBeGreaterThan(times[i - 1])
    })
  })

  it('refits a piece with a single anchor over the rest of the recording', () => {
    const after = fakeRealign(simple([loc(1, 4, true)]), 36)
    const times = after.locators.map((locator) => locator.timeSec)

    expect(times).toHaveLength(8)
    expect(times[0]).toBe(4)
    expect(times[7]).toBeLessThan(36)
    expect(after.locators[0].confirmed).toBe(true)
  })

  it('with no confirmed locator keeps the first and last unconfirmed times as the frame and spreads the rest by beats', () => {
    const before = simple([loc(1, 2), loc(2, 99), loc(3, 1), loc(5, 18)])

    const after = fakeRealign(before, 40)

    expect(timesOf(after)).toEqual([2, 6, 10, 14, 18, 22, 26, 30])
    expect(after.locators.every((locator) => !locator.confirmed)).toBe(true)
  })

  it('with no locator at all spreads the slots over the whole recording', () => {
    const after = fakeRealign(simple([], 4), 16)

    expect(timesOf(after)).toEqual([0, 4, 8, 12])
  })

  it('keeps the flags and checked of every locator by bar and pass and gives new locators none', () => {
    const flag: ReviewFlag = { kind: 'crowded', severity: 1, expected: 4, found: 2, factor: 0.5, explainedBy: null, uncertainLine: null }
    const before = scrambled()
    before.locators = before.locators
      .filter((locator) => !(locator.bar === 40 && locator.passIndex === 0))
      .map((locator) =>
        locator.bar === 6 ? { ...locator, flags: [flag], checked: true } : locator.bar === 31 ? { ...locator, flags: [flag] } : locator,
      )

    const after = fakeRealign(before, END)

    const find = (bar: number) => after.locators.find((locator) => locator.bar === bar && locator.passIndex === 0)
    expect(find(6)).toMatchObject({ flags: [flag], checked: true })
    expect(find(31)?.flags).toEqual([flag])
    expect(find(31)).not.toHaveProperty('checked')
    expect(find(40)).toBeDefined()
    expect(find(40)).not.toHaveProperty('flags')
    expect(find(40)).not.toHaveProperty('checked')
    expect(find(7)).not.toHaveProperty('flags')
  })
})

describe('fakeFill', () => {
  it('gives the empty slots a time between their neighbours and leaves every other locator exactly as it is', () => {
    const full = syntheticTiming(DEMO_SPEC)
    const gap = { ...full, locators: full.locators.filter((_, index) => index < 10 || index > 14).map((l, i) => (i === 3 ? { ...l, timeSec: l.timeSec + 0.4 } : l)) }

    const filled = fakeFill(gap, END)

    expect(filled?.locators).toHaveLength(full.locators.length)
    for (const locator of gap.locators) expect(filled?.locators).toContainEqual(locator)
    const added = (filled?.locators ?? []).slice(10, 15)
    for (const locator of added) {
      expect(locator.timeSec).toBeGreaterThan(gap.locators[9].timeSec)
      expect(locator.timeSec).toBeLessThan(gap.locators[10].timeSec)
    }
  })

  it('is null when nothing is empty, and when there is no locator to fill around', () => {
    const full = syntheticTiming(DEMO_SPEC)

    expect(fakeFill(full, END)).toBeNull()
    expect(fakeFill({ ...full, locators: [] }, END)).toBeNull()
  })
})
