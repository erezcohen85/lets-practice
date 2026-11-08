import { describe, expect, it } from 'vitest'
import { doubleTimeBeats, halfTimeBeats, measureScales, pickStretch, type StretchLine } from './regridStretch'
import { type MeterChange } from './types'

// Five lines, 2 s apart from 1 s; the 3rd and the 5th are checked. The piece is 20 s long.
const line = (bar: number, timeSec: number, confirmed = false, passIndex = 0): StretchLine => ({ bar, passIndex, timeSec, confirmed })
const LINES: StretchLine[] = [line(1, 1), line(2, 3), line(3, 5, true), line(4, 7), line(5, 9, true)]
const DURATION = 20
const slot = (bar: number, passIndex = 0) => ({ bar, passIndex })

describe('pickStretch: which lines a button acts on', () => {
  it('two or more selected lines: from the first to the last selected, in time order, however they were chosen', () => {
    const picked = pickStretch(LINES, [slot(4), slot(2)], DURATION)
    expect(picked).toEqual({ ok: true, fromSec: 3, toSec: 7, whole: false, lineTimes: [3, 5, 7], lastSlot: slot(4) })
  })

  it('one selected line: from it to the next checked line', () => {
    const picked = pickStretch(LINES, [slot(1)], DURATION)
    expect(picked).toEqual({ ok: true, fromSec: 1, toSec: 5, whole: false, lineTimes: [1, 3, 5], lastSlot: slot(1) })
  })

  it('one selected line that is checked itself: to the checked line after it, not to itself', () => {
    const picked = pickStretch(LINES, [slot(3)], DURATION)
    expect(picked).toMatchObject({ ok: true, fromSec: 5, toSec: 9, lineTimes: [5, 7, 9] })
  })

  it('one selected line with no checked line after it: to the end of the recording', () => {
    const picked = pickStretch(LINES, [slot(5)], DURATION)
    expect(picked).toEqual({ ok: true, fromSec: 9, toSec: DURATION, whole: false, lineTimes: [9], lastSlot: slot(5) })
  })

  it('nothing selected: the whole piece, from the first line to the end of the recording', () => {
    const picked = pickStretch(LINES, [], DURATION)
    expect(picked).toEqual({ ok: true, fromSec: 1, toSec: DURATION, whole: true, lineTimes: [1, 3, 5, 7, 9], lastSlot: null })
  })

  it('tells the lines of a repeated bar apart by their pass', () => {
    const lines = [line(1, 1), line(2, 3), line(1, 5, false, 1), line(2, 7, false, 1)]
    expect(pickStretch(lines, [slot(2, 1)], DURATION)).toMatchObject({ ok: true, fromSec: 7 })
    expect(pickStretch(lines, [slot(1, 1), slot(2)], DURATION)).toMatchObject({ ok: true, fromSec: 3, toSec: 5 })
  })

  it('a selection with no line to stand on is not the whole piece', () => {
    expect(pickStretch(LINES, [slot(9)], DURATION)).toEqual({ ok: false, reason: 'selection-without-line' })
  })

  it('a piece with no lines has nothing to act on', () => {
    expect(pickStretch([], [], DURATION)).toEqual({ ok: false, reason: 'no-lines' })
  })

  it('a stretch with no room (the line is at or past the end of the recording) is refused', () => {
    expect(pickStretch(LINES, [slot(5)], 9)).toEqual({ ok: false, reason: 'no-room' })
    expect(pickStretch(LINES, [], 1)).toEqual({ ok: false, reason: 'no-room' })
  })
})

describe('Half-time and Double-time', () => {
  const ALL = [1, 2, 3, 4, 5, 6] as const

  it('Half-time doubles the beats a bar, up to 6', () => {
    expect(ALL.map((n) => halfTimeBeats(n))).toEqual([2, 4, 6, null, null, null])
  })

  it('Double-time halves them when they are even, a triple going to 1, down to 1; 5 and 1 have no half', () => {
    expect(ALL.map((n) => doubleTimeBeats(n))).toEqual([null, 1, 1, 2, null, 3])
  })
})

describe('measureScales: what turns the beats of each gap between lines into beats of the first bar\'s meter', () => {
  const MIXED: MeterChange[] = [
    { fromBar: 1, numerator: 3, denominator: 4 },
    { fromBar: 5, numerator: 2, denominator: 4 },
  ]
  // bars 1 to 8, one every 3 s
  const bars = Array.from({ length: 8 }, (_, i) => line(i + 1, i * 3))

  it('is 1 for every gap when the piece keeps one meter', () => {
    expect(measureScales(bars, 0, 21, [{ fromBar: 1, numerator: 5, denominator: 4 }])).toEqual(Array(7).fill(1))
    expect(measureScales(bars, 0, 21, [])).toEqual(Array(7).fill(1))
  })

  it('takes the first line\'s bar as the reference: a 2/4 gap from a 3/4 start counts one and a half', () => {
    const scales = measureScales(bars, 0, 21, MIXED)
    expect(scales.slice(0, 4)).toEqual([1, 1, 1, 1])
    scales.slice(4).forEach((scale) => expect(scale).toBeCloseTo(1.5, 9))
  })

  it('counts a stretch that begins in 2/4 against 2/4: the 3/4 gaps before it are not in it', () => {
    expect(measureScales(bars, 12, 21, MIXED)).toEqual([1, 1, 1])
  })

  it('has one scale to each gap between the lines pickStretch measures by, for the same stretch', () => {
    const picked = pickStretch(bars, [slot(2), slot(7)], 100)
    if (!picked.ok) throw new Error('expected a stretch')
    expect(measureScales(bars, picked.fromSec, picked.toSec, MIXED)).toHaveLength(picked.lineTimes.length - 1)
  })

  it('has one scale to a gap between the lines inside the stretch, ends included', () => {
    expect(measureScales(bars, 3, 9, MIXED)).toHaveLength(2)
    expect(measureScales(bars, 3, 3, MIXED)).toEqual([])
  })
})
