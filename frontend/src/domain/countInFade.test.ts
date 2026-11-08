import { COUNT_IN_FADES, fadeGain, fadeLevel, planCountInFade } from '@/domain/countInFade'
import { buildTimeline, planCountIn, type SlotTiming } from '@/domain/tempo'
import { straightMap } from '@/domain/fixtures'
import { type BarMark, type ListedMark } from '@/domain/types'

// 40 bars of 4/4, 2 s each from 1.0 s (a 0.5 s beat); bar 13 starts at 25 s.
const timeline: SlotTiming[] = buildTimeline(straightMap(40).timing)
const FERMATA_TWELVE: BarMark[] = [{ bar: 12, kind: 'fermata' }]

function plan(mode: (typeof COUNT_IN_FADES)[number], loopStart: number, options: { marks?: ListedMark[]; speed?: number; bars?: 0 | 1 | 2 } = {}) {
  const { marks = [], speed = 1, bars = 1 } = options
  const countIn = planCountIn(timeline, marks, loopStart, { speed, tempoSource: 'loop-first-bar', bars })
  return planCountInFade(mode, countIn, { startSec: timeline[loopStart].startSec, firstBeatSec: 0.5, startPosition: loopStart }, speed)
}

describe('fadeGain', () => {
  it('is silent at the start and exactly full at the end', () => {
    expect(fadeGain(0)).toBe(0)
    expect(fadeGain(1)).toBe(1)
  })

  it('is a quarter sine: equal power, so half way is about 0.707', () => {
    expect(fadeGain(0.5)).toBeCloseTo(Math.SQRT1_2, 10)
  })

  it('rises without ever dropping, and never exceeds 1', () => {
    let last = 0
    for (let step = 0; step <= 100; step++) {
      const gain = fadeGain(step / 100)
      expect(gain).toBeGreaterThanOrEqual(last)
      expect(gain).toBeLessThanOrEqual(1)
      last = gain
    }
  })

  it('clamps progress outside 0..1 and reads a bad number as the end', () => {
    expect(fadeGain(-3)).toBe(0)
    expect(fadeGain(7)).toBe(1)
    expect(fadeGain(Number.NaN)).toBe(1)
  })
})

describe('fadeLevel', () => {
  const span = { fromSec: 23, toSec: 25 }

  it('is 0 before the span, rises through it and is 1 from its end on', () => {
    expect(fadeLevel(span, 22)).toBe(0)
    expect(fadeLevel(span, 23)).toBe(0)
    expect(fadeLevel(span, 24)).toBeCloseTo(Math.SQRT1_2, 10)
    expect(fadeLevel(span, 25)).toBe(1)
    expect(fadeLevel(span, 26)).toBe(1)
  })

  it('is 1 with no span', () => {
    expect(fadeLevel(null, 24)).toBe(1)
  })
})

describe('planCountInFade', () => {
  it('Off: never fades', () => {
    expect(plan('off', 12)).toEqual({ span: null, underClicks: null })
    expect(plan('off', 12, { marks: FERMATA_TWELVE })).toEqual({ span: null, underClicks: null })
  })

  it('a pre-roll fades from the start of the pre-roll to the loop start in every mode but Off', () => {
    for (const mode of ['pre-roll', 'pre-roll-and-loop', 'under-clicks'] as const) {
      expect(plan(mode, 12)).toEqual({ span: { fromSec: 23, toSec: 25 }, underClicks: null })
    }
  })

  it('a pre-roll of two bars fades over both', () => {
    expect(plan('pre-roll', 12, { bars: 2 }).span).toEqual({ fromSec: 21, toSec: 25 })
  })

  it('no count-in, no fade', () => {
    expect(plan('under-clicks', 12, { bars: 0 })).toEqual({ span: null, underClicks: null })
    expect(plan('pre-roll-and-loop', 12, { bars: 0 })).toEqual({ span: null, underClicks: null })
  })

  it('a click count-in stays as it is in Off and Pre-roll', () => {
    expect(plan('pre-roll', 12, { marks: FERMATA_TWELVE })).toEqual({ span: null, underClicks: null })
  })

  it('Pre-roll and loop start: after a click count-in the loop fades in over its first beat', () => {
    expect(plan('pre-roll-and-loop', 12, { marks: FERMATA_TWELVE })).toEqual({ span: { fromSec: 25, toSec: 25.5 }, underClicks: null })
  })

  it('Pre-roll and loop start: a loop at bar 1 fades in over its first beat too', () => {
    expect(plan('pre-roll-and-loop', 0)).toEqual({ span: { fromSec: 1, toSec: 1.5 }, underClicks: null })
  })

  it('Under the clicks: starts the recording so it reaches the loop start when the clicks end', () => {
    // One bar of clicks at 1x: 4 x 0.5 s = 2 s of wall, so 2 s of recording: from 23 s.
    expect(plan('under-clicks', 12, { marks: FERMATA_TWELVE })).toEqual({
      span: { fromSec: 23, toSec: 25 },
      underClicks: { startSec: 23, delayWallSec: 0 },
    })
  })

  it('Under the clicks at 0.5x: the clicks last 4 s of wall, which is 2 s of recording', () => {
    const result = plan('under-clicks', 12, { marks: FERMATA_TWELVE, speed: 0.5 })
    expect(result.underClicks).toEqual({ startSec: 23, delayWallSec: 0 })
    expect(result.span).toEqual({ fromSec: 23, toSec: 25 })
  })

  it('Under the clicks at 2x: the clicks last 1 s of wall, which is 2 s of recording', () => {
    expect(plan('under-clicks', 12, { marks: FERMATA_TWELVE, speed: 2 }).underClicks).toEqual({ startSec: 23, delayWallSec: 0 })
  })

  it('Under the clicks, a fermata or rest bar before the loop is still played under the clicks', () => {
    expect(plan('under-clicks', 12, { marks: [{ bar: 12, kind: 'rest' }] }).underClicks).toEqual({ startSec: 23, delayWallSec: 0 })
  })

  it('Under the clicks with the loop at bar 1: clicks only', () => {
    expect(plan('under-clicks', 0)).toEqual({ span: null, underClicks: null })
  })

  it('Under the clicks near the start of the recording waits out the rest of the clicks, so it still arrives on time', () => {
    // Loop at bar 2 (position 1, starts at 3 s): 2 s of clicks would start at 1 s, which is in the recording. Two bars of
    // clicks last 4 s: start would be -1, clamped to 0, so the recording waits 1 s of wall before it plays.
    const result = plan('under-clicks', 1, { bars: 2 })
    expect(result.underClicks).toEqual({ startSec: 0, delayWallSec: 1 })
    expect(result.span).toEqual({ fromSec: 0, toSec: 3 })
  })
})
