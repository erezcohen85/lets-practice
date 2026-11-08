import { listedMarks } from '@/domain/markRanges'
import { expandPlayOrder, straightThrough } from '@/domain/playOrder'
import {
  beatTimes,
  buildTimeline,
  COUNT_IN_BAR_CHOICES,
  cursorAt,
  DEFAULT_COUNT_IN_BARS,
  localTempo,
  planCountIn,
  slotIndexAt,
  SPEED_RANGE,
  snapSpeed,
  type SlotTiming,
} from '@/domain/tempo'
import {
  type BarBox,
  type BarMark,
  type ListedMark,
  type CountInBars,
  type Locator,
  type MeterChange,
  type PageLayer,
  type TimingLayer,
} from '@/domain/types'

const FOUR_FOUR: MeterChange = { fromBar: 1, numerator: 4, denominator: 4 }

function locate(bar: number, timeSec: number, passIndex = 0): Locator {
  return { bar, passIndex, timeSec, confirmed: false }
}

/** A straight-through timing layer; any field can be overridden. */
function timingOf(barCount: number, overrides: Partial<TimingLayer> = {}): TimingLayer {
  return {
    barCount,
    playOrder: straightThrough(barCount),
    meters: [FOUR_FOUR],
    marks: [],
    locators: [],
    ...overrides,
  }
}

describe('buildTimeline', () => {
  it('gives every bar of a straight 4/4 piece at 2 s per bar a bpm of 120', () => {
    const timing = timingOf(4, {
      locators: [locate(1, 1), locate(2, 3), locate(3, 5), locate(4, 7)],
    })

    const timeline = buildTimeline(timing)

    expect(timeline).toHaveLength(4)
    expect(timeline.map((t) => t.startSec)).toEqual([1, 3, 5, 7])
    expect(timeline.map((t) => t.endSec)).toEqual([3, 5, 7, 9])
    expect(timeline.every((t) => !t.interpolated)).toBe(true)
    for (const slot of timeline) {
      const tempo = localTempo(slot)
      expect(tempo.bpm).toBeCloseTo(120)
      expect(tempo.beats).toBe(4)
      expect(tempo.beatSec).toBeCloseTo(0.5)
      expect(tempo.secPerWhole).toBeCloseTo(2)
    }
  })

  it('keeps the same quarter-note pulse across a 4/4 to 3/4 meter change', () => {
    const timing = timingOf(4, {
      meters: [FOUR_FOUR, { fromBar: 3, numerator: 3, denominator: 4 }],
      locators: [locate(1, 0), locate(2, 2), locate(3, 4), locate(4, 5.5)],
    })

    const timeline = buildTimeline(timing)
    const tempos = timeline.map(localTempo)

    expect(timeline.map((t) => t.meter)).toEqual([
      { numerator: 4, denominator: 4 },
      { numerator: 4, denominator: 4 },
      { numerator: 3, denominator: 4 },
      { numerator: 3, denominator: 4 },
    ])
    expect(tempos.map((t) => t.beats)).toEqual([4, 4, 3, 3])
    for (const tempo of tempos) {
      expect(tempo.bpm).toBeCloseTo(120)
      expect(tempo.secPerWhole).toBeCloseTo(2)
    }
    expect(timeline[3].endSec).toBeCloseTo(7)
  })

  it('counts a 6/8 bar as six beats and compares tempo in seconds per whole note', () => {
    const timing = timingOf(2, {
      meters: [{ fromBar: 1, numerator: 6, denominator: 8 }],
      locators: [locate(1, 0), locate(2, 3)],
    })

    const [first] = buildTimeline(timing)
    const tempo = localTempo(first)

    expect(tempo.beats).toBe(6)
    expect(tempo.beatSec).toBeCloseTo(0.5)
    expect(tempo.bpm).toBeCloseTo(120)
    expect(tempo.secPerWhole).toBeCloseTo(4)
  })

  it('shares the gap of an unmatched 3/4 bar between two locators by whole-note length', () => {
    const timing = timingOf(3, {
      meters: [FOUR_FOUR, { fromBar: 2, numerator: 3, denominator: 4 }],
      locators: [locate(1, 0), locate(3, 7)],
    })

    const timeline = buildTimeline(timing)

    expect(timeline.map((t) => t.startSec)).toEqual([0, 4, 7])
    expect(timeline.map((t) => t.endSec)).toEqual([4, 7, 10])
    expect(timeline.map((t) => t.interpolated)).toEqual([false, true, false])
    expect(localTempo(timeline[0]).bpm).toBeCloseTo(60)
    expect(localTempo(timeline[1]).bpm).toBeCloseTo(60)
  })

  it('splits a gap of several unmatched bars into equal parts when the meters match', () => {
    const timing = timingOf(4, { locators: [locate(1, 0), locate(4, 9)] })

    const timeline = buildTimeline(timing)

    expect(timeline.map((t) => t.startSec)).toEqual([0, 3, 6, 9])
    expect(timeline.map((t) => t.interpolated)).toEqual([false, true, true, false])
  })

  it('extrapolates leading bars at the first located bar tempo and trailing bars at the last measured tempo', () => {
    const timing = timingOf(6, {
      locators: [locate(3, 5), locate(4, 7), locate(5, 10)],
    })

    const timeline = buildTimeline(timing)

    expect(timeline.map((t) => t.startSec)).toEqual([1, 3, 5, 7, 10, 13])
    expect(timeline.map((t) => t.endSec)).toEqual([3, 5, 7, 10, 13, 16])
    expect(timeline.map((t) => t.interpolated)).toEqual([true, true, false, false, false, true])
  })

  it('clamps extrapolated starts at 0', () => {
    const timing = timingOf(4, { locators: [locate(3, 1), locate(4, 3)] })

    const timeline = buildTimeline(timing)

    expect(timeline.map((t) => t.startSec)).toEqual([0, 0, 1, 3])
    expect(timeline.map((t) => t.endSec)).toEqual([0, 1, 3, 5])
  })

  it('clamps extrapolated trailing bars at the recording end', () => {
    const timing = timingOf(6, { locators: [locate(3, 5), locate(4, 7)] })

    const timeline = buildTimeline(timing, 10)

    expect(timeline.map((t) => t.startSec)).toEqual([1, 3, 5, 7, 9, 10])
    expect(timeline.map((t) => t.endSec)).toEqual([3, 5, 7, 9, 10, 10])
  })

  it('ends the last slot with the previous bar tempo, clamped to the recording end when given', () => {
    const timing = timingOf(2, { locators: [locate(1, 0), locate(2, 2)] })

    expect(buildTimeline(timing)[1].endSec).toBeCloseTo(4)
    expect(buildTimeline(timing, 100)[1].endSec).toBeCloseTo(4)
    expect(buildTimeline(timing, 3)[1].endSec).toBeCloseTo(3)
  })

  it('returns an empty timeline with fewer than two locators', () => {
    expect(buildTimeline(timingOf(4))).toEqual([])
    expect(buildTimeline(timingOf(4, { locators: [locate(1, 0)] }))).toEqual([])
  })

  it('ignores locators whose slot is not in the play order', () => {
    const timing = timingOf(4, { locators: [locate(1, 0), locate(2, 2, 1)] })

    expect(buildTimeline(timing)).toEqual([])
  })

  it('gives one entry per slot, in slot order, for a repeat map', () => {
    const rows = [
      { from: 1, to: 4 },
      { from: 1, to: 4 },
      { from: 5, to: 8 },
    ]
    const slots = expandPlayOrder(rows, 8)
    const timing = timingOf(8, {
      playOrder: rows,
      locators: slots.map((s) => locate(s.bar, s.position * 2, s.passIndex)),
    })

    const timeline = buildTimeline(timing)

    expect(timeline).toHaveLength(12)
    expect(timeline.map((t) => t.slot)).toEqual(slots)
    expect(timeline.map((t) => t.startSec)).toEqual(slots.map((s) => s.position * 2))
    expect(timeline[4].slot).toEqual({ position: 4, bar: 1, passIndex: 1 })
  })

  it('times the two passes of a repeated bar separately', () => {
    const rows = [
      { from: 1, to: 2 },
      { from: 1, to: 2 },
    ]
    const timing = timingOf(2, {
      playOrder: rows,
      locators: [locate(1, 0), locate(2, 2), locate(1, 4.5, 1), locate(2, 6.5, 1)],
    })

    const timeline = buildTimeline(timing)

    expect(timeline.map((t) => t.startSec)).toEqual([0, 2, 4.5, 6.5])
    expect(timeline.map((t) => t.endSec)).toEqual([2, 4.5, 6.5, 8.5])
  })

  it('uses the first meter change for bars before it and accepts unsorted changes', () => {
    const timing = timingOf(4, {
      meters: [{ fromBar: 3, numerator: 3, denominator: 4 }, { fromBar: 2, numerator: 2, denominator: 4 }],
      locators: [locate(1, 0), locate(4, 6)],
    })

    const timeline = buildTimeline(timing)

    expect(timeline.map((t) => t.meter.numerator)).toEqual([2, 2, 3, 3])
  })

  it('rejects a timing layer without meters or with an impossible meter', () => {
    const locators = [locate(1, 0), locate(2, 2)]

    expect(() => buildTimeline(timingOf(2, { meters: [], locators }))).toThrow(RangeError)
    expect(() =>
      buildTimeline(timingOf(2, { meters: [{ fromBar: 1, numerator: 0, denominator: 4 }], locators })),
    ).toThrow(RangeError)
  })

  it('does not mutate its input', () => {
    const timing = timingOf(4, {
      meters: [{ fromBar: 3, numerator: 3, denominator: 4 }, FOUR_FOUR],
      locators: [locate(3, 4), locate(1, 0)],
    })
    const before = structuredClone(timing)

    buildTimeline(timing, 20)

    expect(timing).toEqual(before)
  })
})

describe('localTempo', () => {
  it('derives beats, beat length, bpm and seconds per whole note from one slot', () => {
    const slot = {
      slot: { position: 0, bar: 1, passIndex: 0 },
      startSec: 2,
      endSec: 5,
      interpolated: false,
      meter: { numerator: 3, denominator: 4 },
    }

    const tempo = localTempo(slot)

    expect(tempo.beats).toBe(3)
    expect(tempo.beatSec).toBeCloseTo(1)
    expect(tempo.bpm).toBeCloseTo(60)
    expect(tempo.secPerWhole).toBeCloseTo(4)
  })
})

describe('beatTimes', () => {
  it('lists the beat positions of bar 1 starting at its start', () => {
    const timing = timingOf(4, {
      locators: [locate(1, 1), locate(2, 3), locate(3, 5), locate(4, 7)],
    })

    const [first] = buildTimeline(timing)

    expect(beatTimes(first)).toEqual([1, 1.5, 2, 2.5])
  })

  it('has one time per beat of a 3/4 bar and does not reach the next bar', () => {
    const timing = timingOf(2, {
      meters: [{ fromBar: 1, numerator: 3, denominator: 4 }],
      locators: [locate(1, 0), locate(2, 1.5)],
    })

    const [first] = buildTimeline(timing)
    const times = beatTimes(first)

    expect(times).toHaveLength(3)
    expect(times[0]).toBeCloseTo(0)
    expect(times[1]).toBeCloseTo(0.5)
    expect(times[2]).toBeCloseTo(1)
  })
})

describe('slotIndexAt', () => {
  const timeline = buildTimeline(
    timingOf(4, { locators: [locate(1, 1), locate(2, 3), locate(3, 5), locate(4, 7)] }),
  )

  it('returns -1 before the first start and after the last end', () => {
    expect(slotIndexAt(timeline, 0.5)).toBe(-1)
    expect(slotIndexAt(timeline, 9.5)).toBe(-1)
  })

  it('returns -1 at exactly the last end', () => {
    expect(slotIndexAt(timeline, 9)).toBe(-1)
  })

  it('returns the slot that starts at an exact start time', () => {
    expect(slotIndexAt(timeline, 1)).toBe(0)
    expect(slotIndexAt(timeline, 3)).toBe(1)
    expect(slotIndexAt(timeline, 7)).toBe(3)
  })

  it('finds the slot that holds a time inside it', () => {
    expect(slotIndexAt(timeline, 2.99)).toBe(0)
    expect(slotIndexAt(timeline, 5.5)).toBe(2)
    expect(slotIndexAt(timeline, 8.99)).toBe(3)
  })

  it('skips the empty slots that clamping leaves at the start of the recording', () => {
    const clamped = buildTimeline(timingOf(4, { locators: [locate(3, 1), locate(4, 3)] }))

    expect(slotIndexAt(clamped, 0)).toBe(1)
    expect(slotIndexAt(clamped, 0.5)).toBe(1)
  })

  it('returns -1 for an empty timeline', () => {
    expect(slotIndexAt([], 1)).toBe(-1)
  })
})

/** A page layer laid out like a printed part: 4 bars per line, 2 lines per page, boxes 100 wide. */
function pageOf(barCount: number, skipBars: number[] = []): PageLayer {
  const bars: BarBox[] = []
  for (let bar = 1; bar <= barCount; bar++) {
    if (skipBars.includes(bar)) continue
    const index = bar - 1
    bars.push({
      bar,
      pageIndex: Math.floor(index / 8),
      x: (index % 4) * 100,
      y: Math.floor((index % 8) / 4) * 60 + 10,
      w: 100,
      h: 50,
    })
  }
  return { partId: 'part-1', bars, rests: [] }
}

describe('cursorAt', () => {
  const straight = buildTimeline(
    timingOf(10, { locators: Array.from({ length: 10 }, (_, k) => locate(k + 1, k * 2)) }),
  )
  const page = pageOf(10)

  it('puts the cursor at the middle of the box halfway through a bar', () => {
    const cursor = cursorAt(straight, page, 3)

    expect(cursor).not.toBeNull()
    expect(cursor?.position).toBe(1)
    expect(cursor?.bar).toBe(2)
    expect(cursor?.passIndex).toBe(0)
    expect(cursor?.fraction).toBeCloseTo(0.5)
    expect(cursor?.box).toEqual(page.bars[1])
    expect(cursor?.x).toBeCloseTo(150)
    expect(cursor?.pageIndex).toBe(0)
  })

  it('starts a bar at the left edge of its box', () => {
    const cursor = cursorAt(straight, page, 4)

    expect(cursor?.bar).toBe(3)
    expect(cursor?.fraction).toBe(0)
    expect(cursor?.x).toBe(200)
  })

  it('turns the page between the last bar of page 0 and the first bar of page 1', () => {
    const before = cursorAt(straight, page, 15.99)
    const after = cursorAt(straight, page, 16)

    expect(before?.bar).toBe(8)
    expect(before?.pageIndex).toBe(0)
    expect(after?.bar).toBe(9)
    expect(after?.pageIndex).toBe(1)
    expect(after?.x).toBe(0)
  })

  it('uses the same box for the second pass of a repeated bar, with passIndex 1', () => {
    const rows = [
      { from: 1, to: 4 },
      { from: 1, to: 4 },
    ]
    const slots = expandPlayOrder(rows, 4)
    const repeated = buildTimeline(
      timingOf(4, {
        playOrder: rows,
        locators: slots.map((s) => locate(s.bar, s.position * 2, s.passIndex)),
      }),
    )
    const layer = pageOf(4)

    const first = cursorAt(repeated, layer, 5)
    const second = cursorAt(repeated, layer, 13)

    expect(first?.bar).toBe(3)
    expect(first?.passIndex).toBe(0)
    expect(second?.bar).toBe(3)
    expect(second?.passIndex).toBe(1)
    expect(second?.position).toBe(6)
    expect(second?.box).toEqual(first?.box)
    expect(second?.fraction).toBeCloseTo(0.5)
    expect(second?.x).toBeCloseTo(250)
  })

  it('returns null when the part has no box for the bar being played', () => {
    const missing = pageOf(10, [2])

    expect(cursorAt(straight, missing, 3)).toBeNull()
    expect(cursorAt(straight, missing, 1)?.bar).toBe(1)
  })

  it('returns null before the first slot starts, after the last one ends, and for an empty timeline', () => {
    const later = buildTimeline(timingOf(4, { locators: [locate(1, 1), locate(2, 3), locate(3, 5), locate(4, 7)] }))
    const layer = pageOf(4)

    expect(cursorAt(later, layer, 0.5)).toBeNull()
    expect(cursorAt(later, layer, 9)).toBeNull()
    expect(cursorAt(later, layer, 20)).toBeNull()
    expect(cursorAt([], layer, 1)).toBeNull()
  })

  it('never divides by zero on a zero-length slot', () => {
    const slotAt = (position: number, startSec: number, endSec: number): SlotTiming => ({
      slot: { position, bar: position + 1, passIndex: 0 },
      startSec,
      endSec,
      interpolated: true,
      meter: { numerator: 4, denominator: 4 },
    })
    const layer = pageOf(3)
    const empty = [slotAt(0, 0, 2), slotAt(1, 2, 2), slotAt(2, 2, 4)]
    const atEnd = [slotAt(0, 0, 2), slotAt(1, 2, 2)]

    const skipped = cursorAt(empty, layer, 2)

    expect(skipped?.bar).toBe(3)
    expect(skipped?.fraction).toBe(0)
    expect(Number.isFinite(skipped?.x)).toBe(true)
    expect(cursorAt(atEnd, layer, 2)).toBeNull()
  })

  it('stays finite where the recording end clamps the trailing bars to nothing', () => {
    const clamped = buildTimeline(timingOf(6, { locators: [locate(3, 5), locate(4, 7)] }), 10)
    const layer = pageOf(6)

    const last = cursorAt(clamped, layer, 9.5)

    expect(last?.bar).toBe(5)
    expect(last?.fraction).toBeCloseTo(0.5)
    expect(cursorAt(clamped, layer, 10)).toBeNull()
  })

  it('takes recording time only, so the speed setting never moves the cursor', () => {
    expect(cursorAt.length).toBe(3)
  })

  it('does not mutate its inputs', () => {
    const timelineBefore = structuredClone(straight)
    const pageBefore = structuredClone(page)

    cursorAt(straight, page, 3)

    expect(straight).toEqual(timelineBefore)
    expect(page).toEqual(pageBefore)
  })
})

describe('planCountIn', () => {
  /** Straight 4/4 at 2 s per bar (120 bpm): bar n starts at (n - 1) * 2. */
  const straight = buildTimeline(
    timingOf(8, { locators: [locate(1, 0), locate(2, 2), locate(3, 4), locate(4, 6), locate(5, 8), locate(6, 10), locate(7, 12), locate(8, 14)] }),
  )
  const loopFirstBar = { speed: 1, tempoSource: 'loop-first-bar' } as const

  /** Bars 1-3 at 2 s, bar 4 held for 4 s, bar 5 at 2 s: the fermata case from the plan. */
  const held = buildTimeline(
    timingOf(6, { locators: [locate(1, 0), locate(2, 2), locate(3, 4), locate(4, 6), locate(5, 10), locate(6, 12)] }),
  )
  const fermataOnBar4: BarMark[] = [{ bar: 4, kind: 'fermata' }]

  it('counts in with clicks from the start of bar 1 when the loop starts at the first slot', () => {
    const plan = planCountIn(straight, [], 0, loopFirstBar)

    expect(plan.type).toBe('click')
    expect(plan.recordingStartSec).toBe(0)
    expect(plan.beats).toBe(4)
    expect(plan.beatWallSec).toBeCloseTo(0.5)
    expect(plan.bpmWall).toBeCloseTo(120)
  })

  it('starts bar 1 at its own start when the first bar is not at time 0', () => {
    const later = buildTimeline(timingOf(3, { locators: [locate(1, 1.5), locate(2, 3.5), locate(3, 5.5)] }))

    const plan = planCountIn(later, [], 0, loopFirstBar)

    expect(plan.type).toBe('click')
    expect(plan.recordingStartSec).toBe(1.5)
  })

  it('pre-rolls from the previous bar when a loop in straight 4/4 at 120 bpm starts at bar 5', () => {
    const plan = planCountIn(straight, [], 4, loopFirstBar)

    expect(plan.type).toBe('pre-roll')
    expect(plan.recordingStartSec).toBe(6)
    expect(plan.beats).toBe(4)
    expect(plan.beatWallSec).toBeCloseTo(0.5)
    expect(plan.bpmWall).toBeCloseTo(120)
  })

  it('stretches the pre-roll count at 0.75x to 0.6667 s per count and 90 bpm', () => {
    const plan = planCountIn(straight, [], 4, { speed: 0.75, tempoSource: 'loop-first-bar' })

    expect(plan.type).toBe('pre-roll')
    expect(plan.recordingStartSec).toBe(6)
    expect(plan.beats).toBe(4)
    expect(plan.beatWallSec).toBeCloseTo(0.5 / 0.75)
    expect(plan.beatWallSec).toBeCloseTo(0.6667, 4)
    expect(plan.bpmWall).toBeCloseTo(90)
  })

  it('pre-rolls the same way whichever tempo source is chosen, because it follows the recorded bar before', () => {
    const fromLoop = planCountIn(straight, [], 4, { speed: 0.75, tempoSource: 'loop-first-bar' })
    const fromBefore = planCountIn(straight, [], 4, { speed: 0.75, tempoSource: 'bar-before' })

    expect(fromBefore).toEqual(fromLoop)
  })

  it('clicks in right after a fermata at the loop first bar tempo: 0.5 s per beat', () => {
    const plan = planCountIn(held, fermataOnBar4, 4, loopFirstBar)

    expect(plan.type).toBe('click')
    expect(plan.recordingStartSec).toBe(10)
    expect(plan.beats).toBe(4)
    expect(plan.beatWallSec).toBeCloseTo(0.5)
    expect(plan.bpmWall).toBeCloseTo(120)
  })

  it('clicks in right after a fermata at the bar before tempo: 1.0 s per beat', () => {
    const plan = planCountIn(held, fermataOnBar4, 4, { speed: 1, tempoSource: 'bar-before' })

    expect(plan.type).toBe('click')
    expect(plan.recordingStartSec).toBe(10)
    expect(plan.beats).toBe(4)
    expect(plan.beatWallSec).toBeCloseTo(1)
    expect(plan.bpmWall).toBeCloseTo(60)
  })

  it('scales both fermata tempo sources by the playback speed at 0.75x', () => {
    const fromLoop = planCountIn(held, fermataOnBar4, 4, { speed: 0.75, tempoSource: 'loop-first-bar' })
    const fromBefore = planCountIn(held, fermataOnBar4, 4, { speed: 0.75, tempoSource: 'bar-before' })

    expect(fromLoop.type).toBe('click')
    expect(fromLoop.beatWallSec).toBeCloseTo(0.5 / 0.75)
    expect(fromLoop.bpmWall).toBeCloseTo(90)
    expect(fromBefore.type).toBe('click')
    expect(fromBefore.beatWallSec).toBeCloseTo(1 / 0.75)
    expect(fromBefore.bpmWall).toBeCloseTo(45)
  })

  it('clicks in when the previous bar is a rest', () => {
    const plan = planCountIn(straight, [{ bar: 4, kind: 'rest' }], 4, loopFirstBar)

    expect(plan.type).toBe('click')
    expect(plan.recordingStartSec).toBe(8)
    expect(plan.beats).toBe(4)
    expect(plan.beatWallSec).toBeCloseTo(0.5)
  })

  it('pre-rolls after a rit. bar: only a fermata or a rest makes the count-in click', () => {
    const plan = planCountIn(straight, [{ bar: 4, kind: 'rit' }], 4, loopFirstBar)

    expect(plan.type).toBe('pre-roll')
    expect(plan.recordingStartSec).toBe(6)
  })

  it('ignores marks on other bars than the one before the loop', () => {
    const marks: ListedMark[] = [
      { bar: 3, kind: 'fermata' },
      { bar: 5, kind: 'rest' },
    ]

    const plan = planCountIn(straight, marks, 4, loopFirstBar)

    expect(plan.type).toBe('pre-roll')
    expect(plan.recordingStartSec).toBe(6)
  })

  it('pre-rolls with the previous 4/4 bar counts when the loop starts on the first 3/4 bar', () => {
    const changed = buildTimeline(
      timingOf(6, {
        meters: [FOUR_FOUR, { fromBar: 5, numerator: 3, denominator: 4 }],
        locators: [locate(1, 0), locate(2, 2), locate(3, 4), locate(4, 6), locate(5, 8), locate(6, 9.5)],
      }),
    )

    const plan = planCountIn(changed, [], 4, loopFirstBar)

    expect(plan.type).toBe('pre-roll')
    expect(plan.recordingStartSec).toBe(6)
    expect(plan.beats).toBe(4)
    expect(plan.beatWallSec).toBeCloseTo(0.5)
  })

  it('clicks in with the new meter beats when a fermata sits before a 3/4 bar', () => {
    const changed = buildTimeline(
      timingOf(6, {
        meters: [FOUR_FOUR, { fromBar: 5, numerator: 3, denominator: 4 }],
        locators: [locate(1, 0), locate(2, 2), locate(3, 4), locate(4, 6), locate(5, 10), locate(6, 11.5)],
      }),
    )

    const fromLoop = planCountIn(changed, fermataOnBar4, 4, loopFirstBar)
    const fromBefore = planCountIn(changed, fermataOnBar4, 4, { speed: 1, tempoSource: 'bar-before' })

    expect(fromLoop.beats).toBe(3)
    expect(fromLoop.beatWallSec).toBeCloseTo(0.5)
    expect(fromBefore.beats).toBe(3)
    expect(fromBefore.beatWallSec).toBeCloseTo(1)
  })

  it('pre-rolls from the previous slot when the loop starts on the second pass of bar 1', () => {
    const repeated = buildTimeline(
      timingOf(4, {
        playOrder: [
          { from: 1, to: 2 },
          { from: 1, to: 2 },
          { from: 3, to: 4 },
        ],
        locators: [
          locate(1, 0),
          locate(2, 2),
          locate(1, 4, 1),
          locate(2, 6, 1),
          locate(3, 8),
          locate(4, 10),
        ],
      }),
    )

    const plan = planCountIn(repeated, [], 2, loopFirstBar)

    expect(repeated[2].slot).toEqual({ position: 2, bar: 1, passIndex: 1 })
    expect(plan.type).toBe('pre-roll')
    expect(plan.recordingStartSec).toBe(2)
    expect(plan.beats).toBe(4)
    expect(plan.beatWallSec).toBeCloseTo(0.5)
  })

  it('uses the loop first slot when bar-before has no bar before, at position 0', () => {
    const plan = planCountIn(straight, [], 0, { speed: 0.5, tempoSource: 'bar-before' })

    expect(plan.type).toBe('click')
    expect(plan.recordingStartSec).toBe(0)
    expect(plan.beatWallSec).toBeCloseTo(1)
    expect(plan.bpmWall).toBeCloseTo(60)
  })

  it('rejects a speed that is not above zero or not finite', () => {
    for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planCountIn(straight, [], 4, { speed, tempoSource: 'loop-first-bar' })).toThrow(RangeError)
    }
  })

  it('rejects a loop start that is not a slot of the timeline', () => {
    for (const position of [-1, 8, 1.5, Number.NaN]) {
      expect(() => planCountIn(straight, [], position, loopFirstBar)).toThrow(RangeError)
    }
  })

  it('rejects an empty timeline', () => {
    expect(() => planCountIn([], [], 0, loopFirstBar)).toThrow(RangeError)
  })

  it('does not mutate its inputs', () => {
    const timelineBefore = structuredClone(held)
    const marksBefore = structuredClone(fermataOnBar4)

    planCountIn(held, fermataOnBar4, 4, { speed: 0.75, tempoSource: 'bar-before' })

    expect(held).toEqual(timelineBefore)
    expect(fermataOnBar4).toEqual(marksBefore)
  })

  it('plans the same with no bars option as with bars: 1, at the start and in the middle', () => {
    for (const position of [0, 4]) {
      const omitted = planCountIn(straight, [], position, loopFirstBar)
      const explicit = planCountIn(straight, [], position, { ...loopFirstBar, bars: 1 })

      expect(explicit).toEqual(omitted)
    }
  })

  it('lists the one count-in bar of a 1-bar pre-roll and of a 1-bar click', () => {
    expect(planCountIn(straight, [], 4, loopFirstBar).bars).toEqual([{ beats: 4, beatWallSec: 0.5 }])
    expect(planCountIn(straight, [], 0, loopFirstBar).bars).toEqual([{ beats: 4, beatWallSec: 0.5 }])
  })

  it('pre-rolls 2 bars from two bars before the loop at bar 5', () => {
    const plan = planCountIn(straight, [], 4, { ...loopFirstBar, bars: 2 })

    expect(plan.type).toBe('pre-roll')
    expect(plan.recordingStartSec).toBe(4)
    expect(plan.beats).toBe(8)
    expect(plan.bars).toEqual([
      { beats: 4, beatWallSec: 0.5 },
      { beats: 4, beatWallSec: 0.5 },
    ])
    expect(plan.beatWallSec).toBeCloseTo(0.5)
    expect(plan.bpmWall).toBeCloseTo(120)
  })

  it('pre-rolls 4 bars when four bars exist before the loop', () => {
    const plan = planCountIn(straight, [], 4, { ...loopFirstBar, bars: 4 })

    expect(plan.type).toBe('pre-roll')
    expect(plan.recordingStartSec).toBe(0)
    expect(plan.beats).toBe(16)
    expect(plan.bars).toHaveLength(4)
  })

  it('clicks 2 bars when only one bar exists before the loop at bar 2', () => {
    const plan = planCountIn(straight, [], 1, { ...loopFirstBar, bars: 2 })

    expect(plan.type).toBe('click')
    expect(plan.recordingStartSec).toBe(2)
    expect(plan.beats).toBe(8)
    expect(plan.beatWallSec).toBeCloseTo(0.5)
    expect(plan.bpmWall).toBeCloseTo(120)
    expect(plan.bars).toEqual([
      { beats: 4, beatWallSec: 0.5 },
      { beats: 4, beatWallSec: 0.5 },
    ])
  })

  it('clicks 3 bars of the loop first bar beats when the loop starts at the first slot', () => {
    const plan = planCountIn(straight, [], 0, { speed: 0.5, tempoSource: 'loop-first-bar', bars: 3 })

    expect(plan.type).toBe('click')
    expect(plan.recordingStartSec).toBe(0)
    expect(plan.beats).toBe(12)
    expect(plan.beatWallSec).toBeCloseTo(1)
    expect(plan.bars).toEqual([
      { beats: 4, beatWallSec: 1 },
      { beats: 4, beatWallSec: 1 },
      { beats: 4, beatWallSec: 1 },
    ])
  })

  it('pre-rolls 2 bars across a held bar with each bar at its own tempo', () => {
    const plan = planCountIn(held, [], 5, { ...loopFirstBar, bars: 2 })

    expect(plan.type).toBe('pre-roll')
    expect(plan.recordingStartSec).toBe(6)
    expect(plan.beats).toBe(8)
    expect(plan.bars).toEqual([
      { beats: 4, beatWallSec: 1 },
      { beats: 4, beatWallSec: 0.5 },
    ])
    expect(plan.beatWallSec).toBeCloseTo(1)
    expect(plan.bpmWall).toBeCloseTo(60)
  })

  it('stretches every pre-roll bar by the speed at 0.5x', () => {
    const plan = planCountIn(held, [], 5, { speed: 0.5, tempoSource: 'loop-first-bar', bars: 2 })

    expect(plan.type).toBe('pre-roll')
    expect(plan.bars).toEqual([
      { beats: 4, beatWallSec: 2 },
      { beats: 4, beatWallSec: 1 },
    ])
    expect(plan.beatWallSec).toBeCloseTo(2)
    expect(plan.bpmWall).toBeCloseTo(30)
  })

  it('follows the part: a loop clicks for the part that rests the bar before it and pre-rolls for the part that plays it', () => {
    const timing: TimingLayer = { ...timingOf(8), marks: [{ bar: 6, kind: 'fermata' }] }
    const flute: PageLayer = { partId: 'flute', bars: [], rests: [3] }
    const oboe: PageLayer = { partId: 'oboe', bars: [], rests: [5] }

    // The loop starts on bar 4 (position 3): the bar before it is bar 3, which only the flute rests.
    expect(planCountIn(straight, listedMarks(timing, flute), 3, loopFirstBar).type).toBe('click')
    expect(planCountIn(straight, listedMarks(timing, oboe), 3, loopFirstBar).type).toBe('pre-roll')
  })

  it('a fermata of the timing stops the pre-roll in every part', () => {
    const timing: TimingLayer = { ...timingOf(8), marks: [{ bar: 6, kind: 'fermata' }] }
    const flute: PageLayer = { partId: 'flute', bars: [], rests: [3] }
    const oboe: PageLayer = { partId: 'oboe', bars: [], rests: [] }

    // The loop starts on bar 7: the bar before it, bar 6, holds the fermata.
    expect(planCountIn(straight, listedMarks(timing, flute), 6, loopFirstBar).type).toBe('click')
    expect(planCountIn(straight, listedMarks(timing, oboe), 6, loopFirstBar).type).toBe('click')
  })

  it('clicks 2 bars when a rest sits inside the count-in, but pre-rolls 1 bar with the same marks', () => {
    const restOnBar3: ListedMark[] = [{ bar: 3, kind: 'rest' }]

    const two = planCountIn(straight, restOnBar3, 4, { ...loopFirstBar, bars: 2 })
    const one = planCountIn(straight, restOnBar3, 4, { ...loopFirstBar, bars: 1 })

    expect(two.type).toBe('click')
    expect(two.recordingStartSec).toBe(8)
    expect(two.beats).toBe(8)
    expect(one.type).toBe('pre-roll')
    expect(one.recordingStartSec).toBe(6)
  })

  it('clicks 2 bars after a fermata and lets the toggle pick the click tempo', () => {
    const fromLoop = planCountIn(held, fermataOnBar4, 4, { ...loopFirstBar, bars: 2 })
    const fromBefore = planCountIn(held, fermataOnBar4, 4, { speed: 1, tempoSource: 'bar-before', bars: 2 })

    expect(fromLoop.type).toBe('click')
    expect(fromLoop.recordingStartSec).toBe(10)
    expect(fromLoop.beats).toBe(8)
    expect(fromLoop.beatWallSec).toBeCloseTo(0.5)
    expect(fromBefore.type).toBe('click')
    expect(fromBefore.recordingStartSec).toBe(10)
    expect(fromBefore.beats).toBe(8)
    expect(fromBefore.beatWallSec).toBeCloseTo(1)
    expect(fromBefore.bars).toEqual([
      { beats: 4, beatWallSec: 1 },
      { beats: 4, beatWallSec: 1 },
    ])
  })

  it('counts each pre-rolled bar with its own meter when the count-in crosses a meter change', () => {
    const changed = buildTimeline(
      timingOf(6, {
        meters: [FOUR_FOUR, { fromBar: 5, numerator: 3, denominator: 4 }],
        locators: [locate(1, 0), locate(2, 2), locate(3, 4), locate(4, 6), locate(5, 8), locate(6, 9.5)],
      }),
    )

    const beforeChange = planCountIn(changed, [], 4, { ...loopFirstBar, bars: 2 })
    const across = planCountIn(changed, [], 5, { ...loopFirstBar, bars: 2 })

    expect(beforeChange.type).toBe('pre-roll')
    expect(beforeChange.bars.map((bar) => bar.beats)).toEqual([4, 4])
    expect(beforeChange.beats).toBe(8)
    expect(across.type).toBe('pre-roll')
    expect(across.recordingStartSec).toBe(6)
    expect(across.bars.map((bar) => bar.beats)).toEqual([4, 3])
    expect(across.beats).toBe(7)
    expect(across.beatWallSec).toBeCloseTo(0.5)
  })

  it('plays no count with bars: 0 and starts at the loop first bar', () => {
    const middle = planCountIn(straight, [], 4, { ...loopFirstBar, bars: 0 })
    const start = planCountIn(straight, [], 0, { ...loopFirstBar, bars: 0 })

    expect(middle).toEqual({ type: 'off', beats: 0, beatWallSec: 0, bpmWall: 0, recordingStartSec: 8, bars: [] })
    expect(start).toEqual({ type: 'off', beats: 0, beatWallSec: 0, bpmWall: 0, recordingStartSec: 0, bars: [] })
  })

  it('still checks the loop start and the speed when the count-in is off', () => {
    expect(() => planCountIn(straight, [], 8, { ...loopFirstBar, bars: 0 })).toThrow(RangeError)
    expect(() => planCountIn(straight, [], 4, { speed: 0, tempoSource: 'loop-first-bar', bars: 0 })).toThrow(RangeError)
  })

  it('rejects a count-in length that is not a whole number from 0 to 4', () => {
    for (const bars of [5, -1, 1.5, Number.NaN]) {
      expect(() => planCountIn(straight, [], 4, { ...loopFirstBar, bars: bars as CountInBars })).toThrow(RangeError)
    }
  })

  it('does not mutate its inputs with a multi-bar count-in', () => {
    const timelineBefore = structuredClone(held)
    const marksBefore = structuredClone(fermataOnBar4)

    planCountIn(held, fermataOnBar4, 5, { speed: 0.75, tempoSource: 'bar-before', bars: 3 })

    expect(held).toEqual(timelineBefore)
    expect(fermataOnBar4).toEqual(marksBefore)
  })
})

describe('the speed range', () => {
  it('runs from a quarter to double speed in steps of 0.05, with normal speed in it', () => {
    expect(SPEED_RANGE).toEqual({ min: 0.25, max: 2, step: 0.05 })
    expect(snapSpeed(1)).toBe(1)
  })

  it('snaps any speed in the range to the nearest 0.05, without float noise', () => {
    expect(snapSpeed(0.85)).toBe(0.85)
    expect(snapSpeed(0.8)).toBe(0.8)
    expect(snapSpeed(0.82)).toBe(0.8)
    expect(snapSpeed(0.826)).toBe(0.85)
    expect(snapSpeed(0.35)).toBe(0.35)
    expect(snapSpeed(1.95)).toBe(1.95)
  })

  it('keeps both ends and refuses what is outside them, or not a number', () => {
    expect(snapSpeed(0.25)).toBe(0.25)
    expect(snapSpeed(2)).toBe(2)
    expect(snapSpeed(0.2)).toBeNull()
    expect(snapSpeed(2.05)).toBeNull()
    expect(snapSpeed(0)).toBeNull()
    expect(snapSpeed(-1)).toBeNull()
    expect(snapSpeed(Number.NaN)).toBeNull()
    expect(snapSpeed(Infinity)).toBeNull()
  })
})

describe('count-in length choices', () => {
  it('offers off and one to four bars, with one bar as the default', () => {
    expect(COUNT_IN_BAR_CHOICES).toEqual([0, 1, 2, 3, 4])
    expect(DEFAULT_COUNT_IN_BARS).toBe(1)
  })
})

describe('short bars and the pickup', () => {
  const SIX_EIGHT: MeterChange = { fromBar: 1, numerator: 6, denominator: 8 }
  // Eighths of 0.4 s: a pickup of one eighth from 0.5 s, then bars of 2.4 s from 0.9 s.
  const pickupTiming = timingOf(4, {
    meters: [SIX_EIGHT],
    playOrder: [{ from: 0, to: 4 }],
    shortBars: [{ bar: 0, units: 1 }],
    locators: [locate(0, 0.5), locate(1, 0.9), locate(2, 3.3), locate(3, 5.7), locate(4, 8.1)],
  })

  it('places a pickup before bar 1 with only its own beats', () => {
    const timeline = buildTimeline(pickupTiming)

    expect(timeline.map((t) => t.slot.bar)).toEqual([0, 1, 2, 3, 4])
    expect(timeline[0]).toMatchObject({ startSec: 0.5, endSec: 0.9, units: 1 })
    expect(timeline[1].units).toBeUndefined()
    expect(localTempo(timeline[0])).toMatchObject({ beats: 1 })
    expect(localTempo(timeline[0]).beatSec).toBeCloseTo(0.4)
    expect(localTempo(timeline[0]).secPerWhole).toBeCloseTo(3.2)
    expect(localTempo(timeline[1]).beats).toBe(6)
    expect(beatTimes(timeline[0])).toEqual([0.5])
  })

  it('shares the time between two locators in proportion to the short bar length', () => {
    // bar 3 holds 3 of 6 eighths and has no locator: 2.4 s + 1.2 s are shared 2:1 between 3.3 and 6.9
    const timing = timingOf(4, {
      meters: [SIX_EIGHT],
      shortBars: [{ bar: 3, units: 3 }],
      locators: [locate(1, 0.9), locate(2, 3.3), locate(4, 6.9)],
    })

    const timeline = buildTimeline(timing)

    expect(timeline.map((t) => t.startSec)).toEqual([0.9, 3.3, 5.7, 6.9])
    expect(timeline[2].units).toBe(3)
    expect(localTempo(timeline[2]).bpm).toBeCloseTo(150)
  })

  it('walks back before the first locator with the pickup short', () => {
    const timing = timingOf(2, {
      meters: [SIX_EIGHT],
      playOrder: [{ from: 0, to: 2 }],
      shortBars: [{ bar: 0, units: 2 }],
      locators: [locate(1, 1.6), locate(2, 4)],
    })

    const timeline = buildTimeline(timing)

    expect(timeline[0].startSec).toBeCloseTo(0.8)
  })

  describe('the count-in of a loop that starts on the pickup', () => {
    it('counts up to the pickup place in the bar: five counts in 6/8, the pickup is the sixth', () => {
      const plan = planCountIn(buildTimeline(pickupTiming), [], 0, { speed: 1, tempoSource: 'loop-first-bar' })

      expect(plan.type).toBe('click')
      expect(plan.beats).toBe(5)
      expect(plan.beatWallSec).toBeCloseTo(0.4)
      expect(plan.bars).toEqual([{ beats: 5, beatWallSec: plan.beatWallSec }])
      expect(plan.recordingStartSec).toBe(0.5)
    })

    it('takes the pulse of the bar after the pickup, not of the pickup itself', () => {
      const rough = buildTimeline({ ...pickupTiming, locators: [locate(0, 0.3), locate(1, 0.9), locate(2, 3.3), locate(3, 5.7)] })

      const plan = planCountIn(rough, [], 0, { speed: 2, tempoSource: 'loop-first-bar' })

      expect(plan.beatWallSec).toBeCloseTo(0.2)
    })

    it('counts full bars first when the count-in is longer than one bar', () => {
      const plan = planCountIn(buildTimeline(pickupTiming), [], 0, { speed: 1, tempoSource: 'loop-first-bar', bars: 2 })

      expect(plan.bars.map((bar) => bar.beats)).toEqual([6, 5])
      expect(plan.beats).toBe(11)
    })
  })

  describe('the count-in of a loop that starts at bar 1, after a pickup with no bar before it', () => {
    it.each([
      [6, 8, 1],
      [6, 8, 2],
      [4, 4, 3],
      [3, 4, 2],
    ])('clicks whole bars at the tempo of bar 1 in %i/%i with a pickup of %i', (numerator, denominator, units) => {
      const timeline = buildTimeline(
        timingOf(3, {
          meters: [{ fromBar: 1, numerator, denominator }],
          playOrder: [{ from: 0, to: 3 }],
          shortBars: [{ bar: 0, units }],
          locators: [locate(0, 1), locate(1, 1 + units * 0.5), locate(2, 1 + (units + numerator) * 0.5), locate(3, 1 + (units + 2 * numerator) * 0.5)],
        }),
      )

      const plan = planCountIn(timeline, [], 1, { speed: 1, tempoSource: 'loop-first-bar' })

      expect(plan.type).toBe('click')
      expect(plan.bars.map((bar) => bar.beats)).toEqual([numerator])
      expect(plan.beatWallSec).toBeCloseTo(0.5)
      expect(plan.recordingStartSec).toBeCloseTo(1 + units * 0.5)
    })

    it('never takes the tempo from the pickup, even with the toggle on the bar before', () => {
      const rough = buildTimeline({ ...pickupTiming, locators: [locate(0, 0.3), locate(1, 0.9), locate(2, 3.3), locate(3, 5.7)] })

      expect(planCountIn(rough, [], 1, { speed: 1, tempoSource: 'bar-before' }).beatWallSec).toBeCloseTo(0.4)
    })

    it('still counts two whole bars when the count-in is two bars', () => {
      expect(planCountIn(buildTimeline(pickupTiming), [], 1, { speed: 1, tempoSource: 'loop-first-bar', bars: 2 }).bars.map((bar) => bar.beats)).toEqual([6, 6])
    })
  })

  it('clicks when a top pickup leaves fewer whole bars than the count-in asks for, and replays the ones there are', () => {
    const timeline = buildTimeline(pickupTiming)

    expect(planCountIn(timeline, [], 2, { speed: 1, tempoSource: 'loop-first-bar', bars: 1 })).toMatchObject({ type: 'pre-roll', beats: 6, recordingStartSec: 0.9 })
    expect(planCountIn(timeline, [], 2, { speed: 1, tempoSource: 'loop-first-bar', bars: 2 })).toMatchObject({ type: 'click', beats: 12 })
  })

  describe('a pickup in the middle of the piece, in any meter and any length', () => {
    const CASES: [number, number, number][] = [
      [4, 4, 1],
      [4, 4, 3],
      [6, 8, 1],
      [6, 8, 2],
      [3, 4, 2],
      [2, 4, 1],
      [5, 8, 3],
      [12, 8, 4],
    ]
    const BEAT_SEC = 0.5

    /** Eight bars, a beat of 0.5 s: bar 6 is the pickup (position 5) and completes bar 5 (position 4). */
    function midPickup(numerator: number, denominator: number, units: number) {
      const barSec = numerator * BEAT_SEC
      const times = [0, 1, 2, 3, 4].map((bar) => bar * barSec)
      times.push(5 * barSec - units * BEAT_SEC, 5 * barSec, 6 * barSec)
      return buildTimeline(
        timingOf(8, {
          meters: [{ fromBar: 1, numerator, denominator }],
          shortBars: [{ bar: 6, units, unnumbered: true }],
          locators: times.map((timeSec, i) => locate(i + 1, timeSec)),
        }),
      )
    }
    const FIRST: { speed: number; tempoSource: 'loop-first-bar' } = { speed: 1, tempoSource: 'loop-first-bar' }

    it('marks only the pickup as one', () => {
      expect(midPickup(4, 4, 1).map((played) => played.pickup === true)).toEqual([false, false, false, false, false, true, false, false])
    })

    it.each(CASES)('a loop after it counts the pickup and the bar before as one bar in %i/%i with a pickup of %i', (numerator, denominator, units) => {
      const timeline = midPickup(numerator, denominator, units)

      const plan = planCountIn(timeline, [], 6, { ...FIRST, bars: 1 })

      expect(plan.type).toBe('pre-roll')
      expect(plan.beats).toBe(numerator)
      expect(plan.bars.map((bar) => bar.beats)).toEqual([numerator - units, units])
      expect(plan.recordingStartSec).toBeCloseTo(timeline[4].startSec)
      expect(plan.beatWallSec).toBeCloseTo(BEAT_SEC)
    })

    it.each(CASES)('a two-bar count-in after it reaches one whole bar further back in %i/%i with a pickup of %i', (numerator, denominator, units) => {
      const timeline = midPickup(numerator, denominator, units)

      const plan = planCountIn(timeline, [], 6, { ...FIRST, bars: 2 })

      expect(plan.type).toBe('pre-roll')
      expect(plan.beats).toBe(2 * numerator)
      expect(plan.bars.map((bar) => bar.beats)).toEqual([numerator, numerator - units, units])
      expect(plan.recordingStartSec).toBeCloseTo(timeline[3].startSec)
    })

    it.each(CASES)('a loop on it replays up to its place in the bar in %i/%i with a pickup of %i', (numerator, denominator, units) => {
      const timeline = midPickup(numerator, denominator, units)

      expect(planCountIn(timeline, [], 5, { ...FIRST, bars: 1 })).toMatchObject({ type: 'pre-roll', beats: numerator - units, recordingStartSec: timeline[4].startSec })
      expect(planCountIn(timeline, [], 5, { ...FIRST, bars: 2 })).toMatchObject({ type: 'pre-roll', beats: 2 * numerator - units, recordingStartSec: timeline[3].startSec })
    })

    it.each(CASES)('a loop on it after a fermata clicks up to its place in the bar in %i/%i with a pickup of %i', (numerator, denominator, units) => {
      const timeline = midPickup(numerator, denominator, units)
      const fermata: ListedMark[] = [{ bar: 5, kind: 'fermata' }]

      expect(planCountIn(timeline, fermata, 5, { ...FIRST, bars: 1 }).bars.map((bar) => bar.beats)).toEqual([numerator - units])
      expect(planCountIn(timeline, fermata, 5, { ...FIRST, bars: 2 }).bars.map((bar) => bar.beats)).toEqual([numerator, numerator - units])
      expect(planCountIn(timeline, fermata, 5, { ...FIRST, bars: 1 }).type).toBe('click')
    })

    it.each([
      ['the pickup', 6],
      ['the bar before it', 5],
    ])('a loop after it clicks a whole bar when %s holds a fermata', (_name, bar) => {
      const plan = planCountIn(midPickup(6, 8, 2), [{ bar, kind: 'fermata' }], 6, { ...FIRST, bars: 1 })

      expect(plan).toMatchObject({ type: 'click', beats: 6, recordingStartSec: midPickup(6, 8, 2)[6].startSec })
    })

    describe('the tempo of the clicks', () => {
      // 4/4 with bar 5 at a beat of 0.25 s, the pickup timed roughly at 1 s, and the bar after it at 0.5 s.
      const uneven = buildTimeline(
        timingOf(8, {
          shortBars: [{ bar: 6, units: 1, unnumbered: true }],
          locators: [0, 2, 4, 6, 8, 8.75, 9.75, 11.75].map((timeSec, i) => locate(i + 1, timeSec)),
        }),
      )

      it('a loop on the pickup takes the pulse of the bar after it, or the bar before with the toggle there', () => {
        const fermata: ListedMark[] = [{ bar: 5, kind: 'fermata' }]

        expect(planCountIn(uneven, fermata, 5, FIRST).beatWallSec).toBeCloseTo(0.5)
        expect(planCountIn(uneven, fermata, 5, { speed: 1, tempoSource: 'bar-before' }).beatWallSec).toBeCloseTo(0.25)
      })

      it('a loop after the pickup with the toggle on the bar before takes the bar before the pickup', () => {
        const fermata: ListedMark[] = [{ bar: 6, kind: 'fermata' }]

        expect(planCountIn(uneven, fermata, 6, { speed: 1, tempoSource: 'bar-before' }).beatWallSec).toBeCloseTo(0.25)
        expect(planCountIn(uneven, fermata, 6, FIRST).beatWallSec).toBeCloseTo(0.5)
      })

      it('follows the speed', () => {
        expect(planCountIn(uneven, [{ bar: 5, kind: 'fermata' }], 5, { speed: 0.5, tempoSource: 'loop-first-bar' }).beatWallSec).toBeCloseTo(1)
      })

      it('keeps the pickup in its own meter when the meter changes after it', () => {
        // 3/4 up to the pickup, then 6/8 with an eighth of 0.5 s: a quarter of 1 s, two clicks, the pickup is the third.
        const changing = buildTimeline(
          timingOf(8, {
            meters: [
              { fromBar: 1, numerator: 3, denominator: 4 },
              { fromBar: 7, numerator: 6, denominator: 8 },
            ],
            shortBars: [{ bar: 6, units: 1, unnumbered: true }],
            locators: [0, 3, 6, 9, 12, 14, 15, 18].map((timeSec, i) => locate(i + 1, timeSec)),
          }),
        )

        const plan = planCountIn(changing, [{ bar: 5, kind: 'fermata' }], 5, FIRST)

        expect(plan.bars.map((bar) => bar.beats)).toEqual([2])
        expect(plan.beatWallSec).toBeCloseTo(1)
      })
    })

    it('goes by the play order: a pickup played again leads back to the bar before it in that pass', () => {
      // Bars 1-5, then back to the pickup (bar 4), then on to bar 8: bar 5 is short the first time, whole the second.
      const timeline = buildTimeline(
        timingOf(8, {
          playOrder: [
            { from: 1, to: 5 },
            { from: 4, to: 8 },
          ],
          shortBars: [{ bar: 4, units: 1, unnumbered: true }],
          locators: [locate(1, 0), locate(2, 2), locate(3, 4), locate(4, 5.5), locate(5, 6), locate(4, 7.5, 1), locate(5, 8, 1), locate(6, 10), locate(7, 12), locate(8, 14)],
        }),
      )

      const plan = planCountIn(timeline, [], 6, { ...FIRST, bars: 1 })

      expect(plan.bars.map((bar) => bar.beats)).toEqual([3, 1])
      expect(plan.recordingStartSec).toBeCloseTo(6)
    })

    it('leaves a short bar that is no pickup as a bar of its own', () => {
      const timeline = buildTimeline(
        timingOf(4, {
          shortBars: [{ bar: 2, units: 3 }],
          locators: [locate(1, 0), locate(2, 2), locate(3, 3.5), locate(4, 5.5)],
        }),
      )

      expect(planCountIn(timeline, [], 2, { ...FIRST, bars: 1 })).toMatchObject({ type: 'pre-roll', beats: 3, recordingStartSec: 2 })
    })
  })
})
