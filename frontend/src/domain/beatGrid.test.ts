import { describe, expect, it } from 'vitest'
import {
  BEATS_PER_BAR_CHOICES,
  CLEAN_HIGH,
  CLEAN_LOW,
  CLEAN_WINDOW,
  LEARN_MAX_OFFSET_SEC,
  LEARN_MIN_LINES,
  SNAP_BEAT_SHARE,
  cleanBeats,
  gridTimes,
  learnPulse,
  measuredBeatsPerBar,
} from './beatGrid'

/** `count` beats `gap` seconds apart, the first at `first`. */
const steady = (count: number, gap = 1, first = 0): number[] => Array.from({ length: count }, (_, i) => first + i * gap)

/** The list matches `expected` in length and, item by item, to a millisecond. */
function expectTimes(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((time, index) => expect(actual[index]).toBeCloseTo(time, 3))
}

describe('the grid constants', () => {
  it('hold the agreed values', () => {
    expect(CLEAN_LOW).toBe(0.6)
    expect(CLEAN_HIGH).toBe(1.6)
    expect(CLEAN_WINDOW).toBe(8)
    expect(LEARN_MIN_LINES).toBe(4)
    expect(LEARN_MAX_OFFSET_SEC).toBe(0.1)
    expect(SNAP_BEAT_SHARE).toBe(0.25)
    expect(BEATS_PER_BAR_CHOICES).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('cleanBeats', () => {
  it('gives a steady grid back unchanged', () => {
    const beats = steady(12, 0.84)
    expectTimes(cleanBeats(beats), beats)
  })

  it('drops a beat that comes too soon after the one before', () => {
    const beats = steady(10, 0.84)
    const withExtra = [...beats.slice(0, 2), beats[1] + 0.28, ...beats.slice(2)]
    expectTimes(cleanBeats(withExtra), beats)
  })

  it('adds a beat in the middle of a gap twice as long as the others', () => {
    const beats = steady(10, 0.84)
    const withHole = beats.filter((_, index) => index !== 4)
    expect(withHole[4] - withHole[3]).toBeCloseTo(1.68, 6)
    expectTimes(cleanBeats(withHole), beats)
  })

  it('adds as many evenly spaced beats as a longer hole needs', () => {
    const beats = steady(12, 0.84)
    const withHole = beats.filter((_, index) => index !== 5 && index !== 6)
    expectTimes(cleanBeats(withHole), beats)
  })

  it('keeps a gap that is only a little off the local gap', () => {
    const beats = [0, 0.84, 1.68, 2.6, 3.44, 4.28, 5.12]
    expectTimes(cleanBeats(beats), beats)
  })

  it('is not thrown off by an extra beat early on, before there are enough gaps to judge by', () => {
    const beats = steady(16, 0.84)
    // 0.52 s is 0.62 and 0.59 s is 0.70 of the first gap: both are close enough to the first beat to be kept
    for (const early of [0.52, 0.59]) {
      const cleaned = cleanBeats([beats[0], early, ...beats.slice(1)])
      expect(cleaned).toHaveLength(16)
      expectTimes(cleaned.slice(2), beats.slice(2))
    }
  })

  it('follows a tempo that slows down slowly', () => {
    const beats = [0]
    let gap = 0.6
    for (let i = 0; i < 20; i++) {
      beats.push(beats[beats.length - 1] + gap)
      gap *= 1.05
    }
    expectTimes(cleanBeats(beats), beats)
  })

  it('gives fewer than 3 beats back as they are', () => {
    expect(cleanBeats([])).toEqual([])
    expect(cleanBeats([1])).toEqual([1])
    expect(cleanBeats([1, 1.1])).toEqual([1, 1.1])
  })

  it('does not change the list it is given', () => {
    const beats = steady(8, 0.84)
    const copy = [...beats]
    cleanBeats([...beats, beats[7] + 0.1])
    cleanBeats(beats)
    expect(beats).toEqual(copy)
  })
})

describe('gridTimes', () => {
  const GRID = steady(20, 1)
  const MANY_BARS = Array.from({ length: 30 }, () => 1)

  it('puts a line on every beat when there is one beat per bar', () => {
    expectTimes(gridTimes(GRID, 2, 6, 1, MANY_BARS), [2, 3, 4, 5])
  })

  it('puts a line on every 2nd beat when there are two beats per bar', () => {
    expectTimes(gridTimes(GRID, 0, 9, 2, MANY_BARS), [0, 2, 4, 6, 8])
  })

  it('puts a line on every 5th or 6th beat when there are five or six beats per bar', () => {
    expectTimes(gridTimes(GRID, 0, 20, 5, MANY_BARS), [0, 5, 10, 15])
    expectTimes(gridTimes(GRID, 1, 20, 6, MANY_BARS), [1, 7, 13, 19])
  })

  it('gives a bar whose share is 3/2 of the reference bar one and a half times the beats, and 2/3 two thirds', () => {
    // 2 beats a bar in 6/8, then two 9/8 bars (3 beats each), then 6/8 again
    expectTimes(gridTimes(GRID, 0, 20, 2, [1, 1.5, 1.5, 1]), [0, 2, 5, 8, 10])
    // 3 beats a bar in 3/4, then 2/4 bars of 2 beats
    expectTimes(gridTimes(GRID, 0, 20, 3, [1, 2 / 3, 2 / 3, 1]), [0, 3, 5, 7, 10])
  })

  it('takes a third of a bar of beats for a one-beat pickup in 3/4 and starts the next bar there', () => {
    expectTimes(gridTimes(GRID, 0, 20, 3, [1 / 3, 1, 1, 1]), [0, 1, 4, 7, 10])
  })

  it('lets a share of a bar end between two beats', () => {
    expectTimes(gridTimes(GRID, 0, 20, 2, [1 / 4, 1, 1]), [0, 0.5, 2.5, 4.5])
  })

  it('stops before endSec, and not on it', () => {
    expectTimes(gridTimes(GRID, 0, 4, 1, MANY_BARS), [0, 1, 2, 3])
    expectTimes(gridTimes(GRID, 0, 4.2, 1, MANY_BARS), [0, 1, 2, 3, 4])
  })

  it('goes on at the last local gap past the last beat', () => {
    const grid = steady(4, 0.5)
    expectTimes(gridTimes(grid, 0, 5, 2, MANY_BARS), [0, 1, 2, 3, 4])
  })

  it('goes on past the last beat even when the share of a bar ends between beats', () => {
    const grid = steady(4, 0.5)
    expectTimes(gridTimes(grid, 1, 5, 1, [1, 1.5, 1]), [1, 1.5, 2.25, 2.75])
  })

  it('shifts every time but the start by the offset', () => {
    expectTimes(gridTimes(GRID, 0, 5, 1, MANY_BARS, 0.03), [0, 1.03, 2.03, 3.03, 4.03])
    expectTimes(gridTimes(GRID, 0, 5, 1, MANY_BARS, -0.03), [0, 0.97, 1.97, 2.97, 3.97, 4.97])
  })

  it('returns the start as given, however far it is from a beat, and counts from the nearest beat', () => {
    expectTimes(gridTimes(GRID, 0.97, 5, 1, MANY_BARS), [0.97, 2, 3, 4])
    expectTimes(gridTimes(GRID, 0.97, 5, 1, MANY_BARS, 0.03), [0.97, 2.03, 3.03, 4.03])
  })

  it('puts a pickup that starts before the first beat in its place and then lands on the beats', () => {
    const grid = steady(10, 0.84, 0.42)
    expectTimes(gridTimes(grid, 0.03, 10, 1, [1 / 3, 1, 1, 1]), [0.03, 0.42, 1.26, 2.1, 2.94])
  })

  it('counts from the first beat when the start is just before it', () => {
    const grid = steady(10, 0.84, 0.42)
    expectTimes(gridTimes(grid, 0.38, 2.5, 1, [1, 1, 1]), [0.38, 1.26, 2.1])
  })

  it('counts from a beat before the first one when the start sits on it', () => {
    // the grid goes on backwards at 0.84 s, so there is a beat at -0.42 s, 0.02 s from the start
    const grid = steady(10, 0.84, 0.42)
    expectTimes(gridTimes(grid, -0.4, 3, 1, [1, 1, 1]), [-0.4, 0.42, 1.26, 2.1])
  })

  it('keeps a start that is between two beats there, and the lines follow in whole steps from that place', () => {
    expectTimes(gridTimes(GRID, 0.5, 4, 1, MANY_BARS), [0.5, 1.5, 2.5, 3.5])
  })

  it('snaps a line to a beat when a step ends within a quarter of a beat of it, and not when it is farther', () => {
    expectTimes(gridTimes(GRID, 0.8, 5, 1, [1 / 3, 1, 1]), [0.8, 1, 2, 3])
    expectTimes(gridTimes(GRID, 0.8, 5, 1, [0.5, 1, 1]), [0.8, 1.3, 2.3, 3.3])
  })

  it('keeps a step that is a bar of another meter exact: a share the list marks as not snapping stays off the beats', () => {
    // one beat per 4/4 bar, then 3/4 bars of 3/4 of a beat: each lands 0.75 of a beat on, not on the whole beat 0.25 away
    const shares = [1, 1, 0.75, 0.75, 0.75, 0.75]
    const snaps = [true, true, false, false, false, false]
    expectTimes(gridTimes(GRID, 0, 20, 1, shares, 0, snaps), [0, 1, 2, 2.75, 3.5, 4.25, 5])
    // with no list every step may snap, as before
    expectTimes(gridTimes(GRID, 0, 20, 1, shares), [0, 1, 2, 3, 4, 5, 6])
  })

  it('goes on from where an exact step left the lines: the whole bars after a 3/4 bar stay 3/4 of a beat off the beats', () => {
    // 4/4 at one beat a bar, one 3/4 bar, then 4/4 again: 2.75, 3.75, 4.75, 5.75, not 2.75, 4, 5, 6
    const shares = [1, 1, 0.75, 1, 1, 1, 1]
    const snaps = [true, true, false, true, true, true, true]
    expectTimes(gridTimes(GRID, 0, 20, 1, shares, 0, snaps), [0, 1, 2, 2.75, 3.75, 4.75, 5.75, 6.75])
  })

  it('snaps a short bar to the beats as shifted by the exact steps before it', () => {
    // 5/4 at one beat a bar, one 4/4 bar (0.8 of a beat, exact), then a bar of 0.8 that may snap: 1.8 + 0.8 = 2.6 lands on 2.8,
    // the beat as the exact step shifted it (0.2 off, within a quarter), not on 3 (0.4 off) or nowhere
    const times = gridTimes(GRID, 0, 20, 1, [1, 0.8, 0.8, 1, 1], 0, [true, false, true, true, true])
    expectTimes(times, [0, 1, 1.8, 2.8, 3.8, 4.8])
  })

  it('is back on the beats when exact steps end on a whole beat', () => {
    // three 2/3-of-a-beat steps end on beat 3; the whole bar after it lands on beat 4
    expectTimes(gridTimes(GRID, 0, 20, 1, [1, 2 / 3, 2 / 3, 2 / 3, 1, 1], 0, [true, false, false, false, true, true]), [0, 1, 1 + 2 / 3, 1 + 4 / 3, 3, 4, 5])
  })

  it('lands an exact step on a beat when it ends within float slack of it, and not when it is only near', () => {
    expect(gridTimes(GRID, 0, 20, 1, [0.9999999, 1], 0, [false, false])[1]).toBe(1)
    expect(gridTimes(GRID, 0, 20, 1, [0.99, 1], 0, [false, false])[1]).toBeCloseTo(0.99, 9)
    expect(gridTimes(GRID, 0, 20, 1, [0.99, 1], 0, [true, true])[1]).toBe(1)
  })

  it('does not snap a line back onto the beat the step started from, so no two lines share a time', () => {
    const times = gridTimes(GRID, 0, 5, 1, [1 / 4, 1, 1])
    expectTimes(times, [0, 0.25, 1, 2])
    expect(new Set(times).size).toBe(times.length)
  })

  it('keeps the parts of a bar split at a repeat between the beats, and the bar after lands on a beat', () => {
    expectTimes(gridTimes(GRID, 0, 20, 1, [1, 2 / 3, 1 / 3, 1]), [0, 1, 1 + 2 / 3, 2, 3])
  })

  it('counts from the last beat when the start is past it', () => {
    const grid = steady(4, 1)
    expectTimes(gridTimes(grid, 6.1, 10, 1, MANY_BARS), [6.1, 7, 8, 9])
  })

  it('gives only the start when there are no slots', () => {
    expect(gridTimes(GRID, 2, 6, 1, [])).toEqual([2])
  })

  it('gives only the start when there are fewer than two beats to measure a gap by', () => {
    expect(gridTimes([], 2, 6, 1, MANY_BARS)).toEqual([2])
    expect(gridTimes([2], 2, 6, 1, MANY_BARS)).toEqual([2])
  })

  it('gives nothing when the start is not before the end', () => {
    expect(gridTimes(GRID, 6, 6, 1, MANY_BARS)).toEqual([])
    expect(gridTimes(GRID, 7, 6, 1, MANY_BARS)).toEqual([])
  })
})

describe('learnPulse', () => {
  const GRID = steady(20, 1)

  it('reads lines on every beat as one beat per bar', () => {
    const result = learnPulse(GRID, [3, 4, 5, 6])
    expect(result?.beatsPerBar).toBe(1)
    expect(result?.offsetSec).toBeCloseTo(0, 6)
  })

  it('reads lines on every 3rd beat as three beats per bar', () => {
    const result = learnPulse(GRID, [0, 3, 6, 9])
    expect(result?.beatsPerBar).toBe(3)
    expect(result?.offsetSec).toBeCloseTo(0, 6)
  })

  it('reads lines on every 2nd and 4th beat too', () => {
    expect(learnPulse(GRID, [1, 3, 5, 7])?.beatsPerBar).toBe(2)
    expect(learnPulse(GRID, [0, 4, 8, 12, 16])?.beatsPerBar).toBe(4)
  })

  it('gives null when the bars do not agree', () => {
    expect(learnPulse(GRID, [0, 1, 3, 4])).toBeNull()
  })

  it('gives null for three lines', () => {
    expect(learnPulse(GRID, [0, 3, 6])).toBeNull()
  })

  it('gives null when a line is 0.2 s from a beat', () => {
    expect(learnPulse(GRID, [0, 3, 6.2, 9])).toBeNull()
  })

  it('reads lines on every 5th and 6th beat as five and six beats per bar', () => {
    expect(learnPulse(GRID, [0, 5, 10, 15])?.beatsPerBar).toBe(5)
    expect(learnPulse(GRID, [1, 7, 13, 19])?.beatsPerBar).toBe(6)
  })

  it('gives null when the bars hold a number of beats there is no choice for', () => {
    expect(learnPulse(steady(40, 1), [0, 7, 14, 21])).toBeNull()
    expect(learnPulse(steady(40, 1), [0, 8, 16, 24])).toBeNull()
  })

  it('gives null when two lines sit on the same beat', () => {
    expect(learnPulse(GRID, [0, 3, 3.02, 6])).toBeNull()
  })

  it('reads a steady 0.03 s shift as that offset', () => {
    const result = learnPulse(GRID, [0.03, 3.03, 6.03, 9.03])
    expect(result?.beatsPerBar).toBe(3)
    expect(result?.offsetSec).toBeCloseTo(0.03, 6)
  })

  it('takes the middle shift, not the average', () => {
    const result = learnPulse(GRID, [0.02, 3.02, 6.02, 9.08])
    expect(result?.offsetSec).toBeCloseTo(0.02, 6)
  })

  it('reads lines a little before the beats as a negative offset', () => {
    const result = learnPulse(GRID, [1.96, 3.96, 5.96, 7.96])
    expect(result?.beatsPerBar).toBe(2)
    expect(result?.offsetSec).toBeCloseTo(-0.04, 6)
  })

  it('does not change the lists it is given', () => {
    const lines = [0.03, 3.03, 6.03, 9.03]
    const grid = [...GRID]
    learnPulse(grid, lines)
    expect(lines).toEqual([0.03, 3.03, 6.03, 9.03])
    expect(grid).toEqual(GRID)
  })
})

describe('measuredBeatsPerBar', () => {
  const GRID = steady(20, 1)

  it('gives the same answer for bars of a whole number of beats from whatever place the lines start at', () => {
    for (const beats of [2, 3]) {
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        const lines = [0, 1, 2, 3, 4].map((bar) => phase + bar * beats)
        expect(measuredBeatsPerBar(GRID, lines)).toBe(beats)
      }
    }
  })

  it('measures bars of two and a half beats as 2 or 3, whichever the place the lines start at gives', () => {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      for (const bars of [3, 4]) {
        const lines = Array.from({ length: bars + 1 }, (_, bar) => phase + bar * 2.5)
        expect([2, 3]).toContain(measuredBeatsPerBar(GRID, lines))
      }
    }
  })

  it('counts the beats inside each bar', () => {
    expect(measuredBeatsPerBar(GRID, [0, 3, 6, 9])).toBe(3)
    expect(measuredBeatsPerBar(GRID, [0, 1, 2, 3])).toBe(1)
    expect(measuredBeatsPerBar(GRID, [0, 4, 8])).toBe(4)
  })

  it('counts the same when the lines sit a little off the beats', () => {
    expect(measuredBeatsPerBar(GRID, [0.03, 3.03, 6.03, 9.03])).toBe(3)
    expect(measuredBeatsPerBar(GRID, [1.97, 4.97, 7.97])).toBe(3)
  })

  it('takes the middle count, so one odd bar does not decide', () => {
    expect(measuredBeatsPerBar(GRID, [0, 2, 4, 6, 9])).toBe(2)
  })

  it('counts five and six beats a bar', () => {
    expect(measuredBeatsPerBar(GRID, [0, 5, 10])).toBe(5)
    expect(measuredBeatsPerBar(GRID, [1, 7, 13])).toBe(6)
    expect(measuredBeatsPerBar(GRID, [0.03, 5.03, 10.03])).toBe(5)
  })

  it('rounds half a beat up, so 4.5 gives 5 and 5.5 gives 6, and takes the middle count among five and six', () => {
    expect(measuredBeatsPerBar(GRID, [0, 4, 9])).toBe(5)
    expect(measuredBeatsPerBar(GRID, [0, 5, 11])).toBe(6)
    expect(measuredBeatsPerBar(GRID, [0, 5, 10, 16])).toBe(5)
  })

  it('keeps the answer within the choices: a median above 6.5 beats is not measured, not turned into 6', () => {
    expect(measuredBeatsPerBar(GRID, [0, 7, 14])).toBeNull()
    expect(measuredBeatsPerBar(GRID, [0, 9, 18])).toBeNull()
    expect(measuredBeatsPerBar(GRID, [0, 7, 15])).toBeNull() // 7 and 8: a median of 7.5
    expect(measuredBeatsPerBar(GRID, [0, 0.8, 1.6])).toBe(1)
  })

  it('still gives 6 for a median of exactly 6.5, the last half a beat that rounds to a choice', () => {
    expect(measuredBeatsPerBar(GRID, [0, 6, 13])).toBe(6) // 6 and 7
    expect(measuredBeatsPerBar(GRID, [0, 7, 13])).toBe(6) // 7 and 6
  })

  describe('with bars of other meters', () => {
    it('turns the beats of each bar into beats of the first bar\'s meter by the scales, one to a gap between lines', () => {
      // 3/4 bars of 3 beats, then 2/4 bars of 2 beats: in 3/4 terms every bar holds 3
      const lines = [0, 3, 6, 9, 11, 13, 15]
      expect(measuredBeatsPerBar(GRID, lines, [1, 1, 1, 1.5, 1.5, 1.5])).toBe(3)
      // the same lines seen from the 2/4 bars: 3/4 bars hold 3 x 2/3 = 2
      expect(measuredBeatsPerBar(GRID, lines, [2 / 3, 2 / 3, 2 / 3, 1, 1, 1])).toBe(2)
    })

    it('measures as before with no scales, or scales of 1', () => {
      expect(measuredBeatsPerBar(GRID, [0, 3, 6, 9], [1, 1, 1])).toBe(3)
      expect(measuredBeatsPerBar(GRID, [0, 3, 6, 9], [])).toBe(3)
    })
  })

  it('gives null when the bars hold less than half a beat', () => {
    expect(measuredBeatsPerBar(GRID, [0, 0.2, 0.4])).toBeNull()
  })

  it('gives null when the lines sit outside the grid', () => {
    const grid = steady(5, 1)
    expect(measuredBeatsPerBar(grid, [10, 12, 14])).toBeNull()
    expect(measuredBeatsPerBar(grid, [-9, -7, -5])).toBeNull()
  })

  it('gives null when there is no bar to measure', () => {
    expect(measuredBeatsPerBar(GRID, [])).toBeNull()
    expect(measuredBeatsPerBar(GRID, [3])).toBeNull()
  })

  it('gives null when there are no beats', () => {
    expect(measuredBeatsPerBar([], [0, 3, 6])).toBeNull()
  })
})
