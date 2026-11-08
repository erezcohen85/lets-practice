import {
  clicksBetween,
  followTarget,
  loopTimes,
  nextLoop,
  normalizePracticeMemory,
  parseRange,
  playProgress,
  passesOf,
  rangeFromTaps,
  rangeLabel,
} from '@/domain/practice'
import { barNamesOf } from '@/domain/barNames'
import { demoDoc } from '@/domain/pieceFixtures'
import { buildTimeline } from '@/domain/tempo'
import { DEFAULT_PRACTICE_MEMORY, type TimingLayer } from '@/domain/types'

const doc = demoDoc()
const timeline = buildTimeline(doc.timing)
const page = doc.pages[0]
const SLOT_SEC = 3.6
const startOf = (position: number) => 1 + SLOT_SEC * position

// Slots of the demo: positions 0-15 are bars 1-16, 16-23 are bars 9-16 again, 24-71 are bars 17-64.
const bars = (range: { startPosition: number; endPosition: number }) => [
  timeline[range.startPosition].slot.bar,
  timeline[range.endPosition].slot.bar,
]

const PLAIN = barNamesOf(undefined)
const TOP = barNamesOf([{ bar: 0, units: 1 }])

describe('passesOf', () => {
  it('gives [0] for a plain bar', () => {
    expect(passesOf(timeline, 5)).toEqual([0])
    expect(passesOf(timeline, 40)).toEqual([0])
  })

  it('gives [0, 1] for a bar inside the repeat', () => {
    expect(passesOf(timeline, 9)).toEqual([0, 1])
    expect(passesOf(timeline, 16)).toEqual([0, 1])
  })

  it('gives [] for a bar that is not played', () => {
    expect(passesOf(timeline, 99)).toEqual([])
  })
})

describe('rangeFromTaps', () => {
  it('runs from a plain bar to the end bar', () => {
    expect(rangeFromTaps(timeline, 2, 5, 0)).toEqual({ startPosition: 1, endPosition: 4 })
  })

  it('makes one bar of the same bar tapped twice', () => {
    expect(rangeFromTaps(timeline, 20, 20, 0)).toEqual({ startPosition: 27, endPosition: 27 })
  })

  it('lets the earlier bar start when the taps come in reverse', () => {
    expect(rangeFromTaps(timeline, 24, 17, 0)).toEqual(rangeFromTaps(timeline, 17, 24, 0))
  })

  it('starts inside the repeat in its first pass', () => {
    expect(rangeFromTaps(timeline, 13, 16, 0)).toEqual({ startPosition: 12, endPosition: 15 })
    expect(rangeFromTaps(timeline, 9, 16, 0)).toEqual({ startPosition: 8, endPosition: 15 })
    expect(rangeFromTaps(timeline, 17, 24, 0)).toEqual({ startPosition: 24, endPosition: 31 })
  })

  it('starts inside the repeat in its second pass and ends at the first slot after it', () => {
    const range = rangeFromTaps(timeline, 13, 24, 1)
    expect(range).toEqual({ startPosition: 20, endPosition: 31 })
    expect(timeline[20].slot).toMatchObject({ bar: 13, passIndex: 1 })
  })

  it('lets the lower bar start even when it was tapped second', () => {
    expect(rangeFromTaps(timeline, 12, 9, 0)).toEqual({ startPosition: 8, endPosition: 8 + 3 })
  })

  it('is null when the start bar has no such pass or is not played', () => {
    expect(rangeFromTaps(timeline, 20, 24, 1)).toBeNull()
    expect(rangeFromTaps(timeline, 99, 24, 0)).toBeNull()
    expect(rangeFromTaps(timeline, 2, 99, 0)).toBeNull()
  })

  it('is null when the end bar is not reachable after the start', () => {
    const order: TimingLayer = {
      ...doc.timing,
      barCount: 16,
      playOrder: [
        { from: 9, to: 16 },
        { from: 1, to: 8 },
      ],
      locators: [
        { bar: 9, passIndex: 0, timeSec: 0, confirmed: false },
        { bar: 1, passIndex: 0, timeSec: 16, confirmed: false },
      ],
      marks: [],
    }
    const swapped = buildTimeline(order)
    expect(rangeFromTaps(swapped, 3, 11, 0)).toBeNull()
    expect(rangeFromTaps(swapped, 11, 12, 0)).toEqual({ startPosition: 2, endPosition: 3 })
  })

  it('is null on an empty timeline', () => {
    expect(rangeFromTaps([], 1, 2, 0)).toBeNull()
  })
})

describe('rangeLabel', () => {
  it('joins the ends with an en dash', () => {
    expect(rangeLabel(timeline, { startPosition: 24, endPosition: 31 }, PLAIN)).toBe('17–24')
  })

  it('shows the pass of a start that is not the first', () => {
    expect(rangeLabel(timeline, { startPosition: 20, endPosition: 31 }, PLAIN)).toBe('13 (2)–24')
  })

  it('shows the pass of an end that is not the first one at or after the start', () => {
    expect(rangeLabel(timeline, { startPosition: 12, endPosition: 23 }, PLAIN)).toBe('13–16 (2)')
  })
})

describe('parseRange', () => {
  it('accepts a hyphen, an en dash and spaces', () => {
    const expected = { range: { startPosition: 24, endPosition: 31 } }
    expect(parseRange(timeline, '17-24', PLAIN)).toEqual(expected)
    expect(parseRange(timeline, '17–24', PLAIN)).toEqual(expected)
    expect(parseRange(timeline, ' 17 – 24 ', PLAIN)).toEqual(expected)
  })

  it('accepts the pass of the start', () => {
    const expected = { range: { startPosition: 20, endPosition: 31 } }
    expect(parseRange(timeline, '13 (2)-24', PLAIN)).toEqual(expected)
    expect(parseRange(timeline, '13 (2)–24', PLAIN)).toEqual(expected)
  })

  it('reads one bar alone as a loop of that bar', () => {
    expect(parseRange(timeline, '20', PLAIN)).toEqual({ range: { startPosition: 27, endPosition: 27 } })
    expect(parseRange(timeline, ' 20 ', PLAIN)).toEqual({ range: { startPosition: 27, endPosition: 27 } })
  })

  it('reads one bar with a pass as a loop of that pass alone', () => {
    expect(parseRange(timeline, '13 (2)', PLAIN)).toEqual({ range: { startPosition: 20, endPosition: 20 } })
  })

  it('refuses one bar the piece does not play, or a pass it does not have', () => {
    expect(parseRange(timeline, '99', PLAIN)).toEqual({ error: 'unknown-bar' })
    expect(parseRange(timeline, '20 (2)', PLAIN)).toEqual({ error: 'unknown-bar' })
  })

  it('round trips every label', () => {
    for (const range of [
      { startPosition: 0, endPosition: 3 },
      { startPosition: 20, endPosition: 31 },
      { startPosition: 12, endPosition: 23 },
      { startPosition: 8, endPosition: 8 },
      { startPosition: 70, endPosition: 71 },
    ]) {
      expect(parseRange(timeline, rangeLabel(timeline, range, PLAIN), PLAIN)).toEqual({ range })
    }
  })

  it('reports a format error for text that is not a range', () => {
    for (const text of ['', 'a-b', '13-', '-24', '13-24-30', '13 (x)-24', '13 (x)']) {
      expect(parseRange(timeline, text, PLAIN)).toEqual({ error: 'format' })
    }
  })

  it('reports an unknown bar or pass', () => {
    expect(parseRange(timeline, '1-99', PLAIN)).toEqual({ error: 'unknown-bar' })
    expect(parseRange(timeline, '0-4', PLAIN)).toEqual({ error: 'unknown-bar' })
    expect(parseRange(timeline, '20 (2)-24', PLAIN)).toEqual({ error: 'unknown-bar' })
    expect(parseRange(timeline, '13 (0)-24', PLAIN)).toEqual({ error: 'unknown-bar' })
  })

  it('reports an order error when the end comes before the start', () => {
    expect(parseRange(timeline, '24-13', PLAIN)).toEqual({ error: 'order' })
  })
})

describe('nextLoop', () => {
  it('moves forward by the length of the range', () => {
    const next = nextLoop(timeline, { startPosition: 20, endPosition: 31 })
    expect(next).toEqual({ startPosition: 32, endPosition: 43 })
    expect(bars(next!)).toEqual([25, 36])
  })

  it('keeps going from one loop to the next', () => {
    const range = rangeFromTaps(timeline, 1, 4, 0)!
    expect(nextLoop(timeline, range)).toEqual({ startPosition: 4, endPosition: 7 })
  })

  it('clamps at the last position', () => {
    expect(nextLoop(timeline, { startPosition: 52, endPosition: 63 })).toEqual({ startPosition: 64, endPosition: 71 })
    expect(bars({ startPosition: 64, endPosition: 71 })).toEqual([57, 64])
  })

  it('is null when the range already ends at the last position', () => {
    expect(nextLoop(timeline, { startPosition: 64, endPosition: 71 })).toBeNull()
  })

  it('is null on an empty timeline', () => {
    expect(nextLoop([], { startPosition: 0, endPosition: 1 })).toBeNull()
  })
})

describe('loopTimes', () => {
  it('runs from the start of the first slot to the end of the last', () => {
    const { startSec, endSec } = loopTimes(timeline, { startPosition: 24, endPosition: 31 })
    expect(startSec).toBeCloseTo(startOf(24))
    expect(endSec).toBeCloseTo(startOf(32))
  })
})

describe('playProgress', () => {
  it('is the share of the loop played, from its start to its end', () => {
    const loop = { startSec: 10, endSec: 20 }
    expect(playProgress(10, loop, 100)).toBe(0)
    expect(playProgress(12.5, loop, 100)).toBeCloseTo(0.25)
    expect(playProgress(20, loop, 100)).toBe(1)
  })

  it('is the share of the whole recording without a loop', () => {
    expect(playProgress(30, null, 120)).toBeCloseTo(0.25)
  })

  it('stays on the ring outside the loop and without a length', () => {
    expect(playProgress(5, { startSec: 10, endSec: 20 }, 100)).toBe(0)
    expect(playProgress(25, { startSec: 10, endSec: 20 }, 100)).toBe(1)
    expect(playProgress(30, null, null)).toBe(0)
    expect(playProgress(30, null, 0)).toBe(0)
    expect(playProgress(30, { startSec: 10, endSec: 10 }, 100)).toBe(0)
  })
})

describe('clicksBetween', () => {
  it('gives four clicks per 4/4 bar, the first one accented', () => {
    const clicks = clicksBetween(timeline, startOf(0), startOf(1))
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false])
    expect(clicks.map((c) => c.timeSec)).toEqual([0, 0.9, 1.8, 2.7].map((t) => expect.closeTo(1 + t)))
  })

  it('crosses a bar line without losing or doubling a click', () => {
    const clicks = clicksBetween(timeline, startOf(0) + 2, startOf(1) + 1)
    expect(clicks.map((c) => c.accent)).toEqual([false, true, false])
    expect(clicks.filter((c) => c.accent)).toHaveLength(1)
    expect(clicks.find((c) => c.accent)?.timeSec).toBeCloseTo(startOf(1))
  })

  it('counts two per bar after the change to 2/4', () => {
    const from = startOf(56)
    const clicks = clicksBetween(timeline, from, startOf(58))
    expect(clicks.map((c) => c.accent)).toEqual([true, false, true, false])
    expect(clicks[1].timeSec).toBeCloseTo(from + SLOT_SEC / 2)
  })

  it('includes the start of the window and leaves out the end', () => {
    const clicks = clicksBetween(timeline, startOf(2), startOf(3))
    expect(clicks[0].timeSec).toBeCloseTo(startOf(2))
    expect(clicksBetween(timeline, startOf(2), startOf(2))).toEqual([])
  })

  it('is empty for an empty window or outside the recording', () => {
    expect(clicksBetween(timeline, 5, 5)).toEqual([])
    expect(clicksBetween(timeline, 6, 5)).toEqual([])
    expect(clicksBetween(timeline, 0, 0.9)).toEqual([])
    expect(clicksBetween(timeline, startOf(72) + 10, startOf(72) + 20)).toEqual([])
    expect(clicksBetween([], 0, 10)).toEqual([])
  })

  it('counts the numerator for a compound meter', () => {
    const sixEight: TimingLayer = {
      barCount: 2,
      playOrder: [{ from: 1, to: 2 }],
      meters: [{ fromBar: 1, numerator: 6, denominator: 8 }],
      marks: [],
      locators: [
        { bar: 1, passIndex: 0, timeSec: 0, confirmed: false },
        { bar: 2, passIndex: 0, timeSec: 3, confirmed: false },
      ],
    }
    expect(clicksBetween(buildTimeline(sixEight), 0, 3)).toHaveLength(6)
  })
})

describe('followTarget', () => {
  it('gives the box of the bar and how far through it the time is', () => {
    const target = followTarget(timeline, page, startOf(2) + SLOT_SEC / 4)
    expect(target?.box.bar).toBe(3)
    expect(target?.fraction).toBeCloseTo(0.25)
    expect(target?.pageIndex).toBe(0)
  })

  it('gives the top of the line for a bar in the middle of it', () => {
    const middle = followTarget(timeline, page, startOf(2) + 0.1)
    const first = followTarget(timeline, page, startOf(0) + 0.1)
    expect(middle?.lineTop).toBe(first?.lineTop)
    expect(middle?.lineTop).toBe(page.bars[0].y)
    const secondLine = followTarget(timeline, page, startOf(5))
    expect(secondLine?.lineTop).toBe(page.bars[4].y)
  })

  it('moves to the next page across a page boundary', () => {
    expect(followTarget(timeline, page, startOf(15))?.pageIndex).toBe(0)
    // Bars 1-16 fill page 0, so the repeat of bars 9-16 stays there and bar 17 (position 24) opens page 1.
    expect(followTarget(timeline, page, startOf(16))?.pageIndex).toBe(0)
    expect(followTarget(timeline, page, startOf(23.5))?.pageIndex).toBe(0)
    const afterRepeat = followTarget(timeline, page, startOf(24))
    expect(afterRepeat?.box.bar).toBe(17)
    expect(afterRepeat?.pageIndex).toBe(1)
    expect(afterRepeat?.lineTop).toBe(page.bars[16].y)
  })

  it('follows the second pass of a repeated bar to the same box', () => {
    const first = followTarget(timeline, page, startOf(8) + 0.9)
    const second = followTarget(timeline, page, startOf(16) + 0.9)
    expect(first?.box.bar).toBe(9)
    expect(second?.box).toEqual(first?.box)
    expect(second?.fraction).toBeCloseTo(first?.fraction ?? -1)
  })

  it('treats boxes a few pixels apart as one line', () => {
    const wobbly = { ...page, bars: page.bars.map((b) => (b.bar === 2 ? { ...b, y: b.y + 3 } : b)) }
    expect(followTarget(timeline, wobbly, startOf(1) + 0.1)?.lineTop).toBe(page.bars[0].y)
  })

  it('is null outside the timeline or when the part has no box for the bar', () => {
    expect(followTarget(timeline, page, 0)).toBeNull()
    expect(followTarget(timeline, page, startOf(72) + 5)).toBeNull()
    expect(followTarget(timeline, { ...page, bars: page.bars.filter((b) => b.bar !== 3) }, startOf(2) + 0.1)).toBeNull()
  })
})

describe('DEFAULT_PRACTICE_MEMORY', () => {
  it('has the metronome off at 0.8 in wood, music at full, normal speed, no loop, count-in once', () => {
    expect(DEFAULT_PRACTICE_MEMORY).toEqual({
      metronome: { on: false, volume: 0.8, tone: 'wood' },
      musicVolume: 1,
      speed: 1,
      loop: null,
      loopOn: true,
      countInEveryRepeat: false,
      countInMetronome: true,
    })
  })
})

describe('normalizePracticeMemory', () => {
  it('gives the default for an empty or unusable stored value', () => {
    for (const stored of [{}, null, undefined, 'x', 3, []]) {
      expect(normalizePracticeMemory(stored)).toEqual(DEFAULT_PRACTICE_MEMORY)
    }
  })

  it('gives a copy, never the default object itself', () => {
    const memory = normalizePracticeMemory({})
    expect(memory).not.toBe(DEFAULT_PRACTICE_MEMORY)
    expect(memory.metronome).not.toBe(DEFAULT_PRACTICE_MEMORY.metronome)
  })

  it('keeps a full valid memory as it is', () => {
    const full = {
      metronome: { on: true, volume: 0.5, tone: 'beep' },
      musicVolume: 0.25,
      speed: 0.75,
      loop: { startPosition: 12, endPosition: 23 },
      loopOn: false,
      countInEveryRepeat: true,
      countInMetronome: false,
    }
    expect(normalizePracticeMemory(full)).toEqual(full)
  })

  it('takes loopOn as on when it is missing or not a boolean: a memory stored before the Loop button hid the marks', () => {
    expect(normalizePracticeMemory({ loop: { startPosition: 1, endPosition: 2 } }).loopOn).toBe(true)
    expect(normalizePracticeMemory({ loopOn: 'no' }).loopOn).toBe(true)
  })

  it('merges a partial value field by field', () => {
    expect(normalizePracticeMemory({ speed: 1.5, metronome: { on: true } })).toEqual({
      ...DEFAULT_PRACTICE_MEMORY,
      speed: 1.5,
      metronome: { on: true, volume: 0.8, tone: 'wood' },
    })
  })

  it('falls back to the default for an unknown tone, a speed outside 0.25 to 2 and a volume out of range', () => {
    const memory = normalizePracticeMemory({
      metronome: { on: true, volume: 1.5, tone: 'cowbell' },
      musicVolume: -0.1,
      speed: 2.5,
    })
    expect(memory).toEqual({ ...DEFAULT_PRACTICE_MEMORY, metronome: { on: true, volume: 0.8, tone: 'wood' } })
    for (const speed of [0.2, 0, -1, Number.NaN, '1', null]) expect(normalizePracticeMemory({ speed }).speed).toBe(1)
    expect(normalizePracticeMemory({ musicVolume: Number.NaN }).musicVolume).toBe(1)
    expect(normalizePracticeMemory({ metronome: { volume: '0.3' } }).metronome.volume).toBe(0.8)
  })

  it('keeps a speed between the old steps, snapped to 0.05: the slider saves 0.85 and it reopens as 0.85', () => {
    expect(normalizePracticeMemory({ speed: 0.85 }).speed).toBe(0.85)
    expect(normalizePracticeMemory({ speed: 1.05 }).speed).toBe(1.05)
    expect(normalizePracticeMemory({ speed: 0.8201 }).speed).toBe(0.8)
    expect(normalizePracticeMemory({ speed: 0.25 }).speed).toBe(0.25)
    expect(normalizePracticeMemory({ speed: 2 }).speed).toBe(2)
  })

  it('accepts the volume range ends', () => {
    expect(normalizePracticeMemory({ musicVolume: 0 }).musicVolume).toBe(0)
    expect(normalizePracticeMemory({ metronome: { volume: 1 } }).metronome.volume).toBe(1)
  })

  it('drops a loop that is not two whole positions in order', () => {
    for (const loop of [{ startPosition: 5 }, { startPosition: -1, endPosition: 3 }, { startPosition: 4, endPosition: 3 }, { startPosition: 1.5, endPosition: 3 }, 'x']) {
      expect(normalizePracticeMemory({ loop }).loop).toBeNull()
    }
    expect(normalizePracticeMemory({ loop: { startPosition: 4, endPosition: 4 } }).loop).toEqual({ startPosition: 4, endPosition: 4 })
  })

  it('takes only booleans for the switches', () => {
    expect(normalizePracticeMemory({ countInEveryRepeat: 'yes', metronome: { on: 1 } })).toEqual(DEFAULT_PRACTICE_MEMORY)
  })
})

describe('the accents around a pickup in the middle of the piece', () => {
  it.each([
    [4, 4, 1],
    [4, 4, 3],
    [6, 8, 2],
    [3, 4, 2],
    [5, 8, 3],
  ])('accents the bars on each side and not the pickup, in %i/%i with a pickup of %i', (numerator, denominator, units) => {
    const barSec = numerator * 0.5
    const timeline = buildTimeline({
      barCount: 4,
      playOrder: [{ from: 1, to: 4 }],
      meters: [{ fromBar: 1, numerator, denominator }],
      marks: [],
      shortBars: [{ bar: 2, units, unnumbered: true }],
      locators: [0, barSec - units * 0.5, barSec, 2 * barSec].map((timeSec, i) => ({ bar: i + 1, passIndex: 0, timeSec, confirmed: false })),
    })

    const clicks = clicksBetween(timeline, 0, 2 * barSec)

    const shortBar = Array.from({ length: numerator - units }, (_, beat) => beat === 0)
    const pickup = Array.from({ length: units }, () => false)
    const barAfter = Array.from({ length: numerator }, (_, beat) => beat === 0)
    expect(clicks.map((click) => click.accent)).toEqual([...shortBar, ...pickup, ...barAfter])
  })
})

describe('a loop on the pickup', () => {
  // 6/8 with eighths of 0.4 s: a pickup eighth at 0.5 s, then bars of 2.4 s.
  const pickupTimeline = buildTimeline({
    barCount: 3,
    playOrder: [{ from: 0, to: 3 }],
    meters: [{ fromBar: 1, numerator: 6, denominator: 8 }],
    marks: [],
    shortBars: [{ bar: 0, units: 1 }],
    locators: [0.5, 0.9, 3.3, 5.7].map((timeSec, bar) => ({ bar, passIndex: 0, timeSec, confirmed: false })),
  })

  it('starts a range at bar 0, by taps and by the typed range', () => {
    expect(rangeFromTaps(pickupTimeline, 0, 2, 0)).toEqual({ startPosition: 0, endPosition: 2 })
    expect(parseRange(pickupTimeline, 'p1-2', TOP)).toEqual({ range: { startPosition: 0, endPosition: 2 } })
    expect(rangeLabel(pickupTimeline, { startPosition: 0, endPosition: 2 }, TOP)).toBe('p1–2')
  })

  it('clicks the pickup without an accent, then the downbeat of bar 1 with one', () => {
    const clicks = clicksBetween(pickupTimeline, 0, 3)

    expect(clicks.map((c) => c.accent)).toEqual([false, true, false, false, false, false, false])
    expect(clicks[0].timeSec).toBe(0.5)
    expect(clicks[1].timeSec).toBeCloseTo(0.9)
  })
})
