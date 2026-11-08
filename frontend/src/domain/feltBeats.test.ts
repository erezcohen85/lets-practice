import { describe, expect, it } from 'vitest'
import { feltBeats, heardBeats, sameMeter } from './feltBeats'
import { expandPlayOrder } from './playOrder'
import { type MeterChange, type TimingLayer } from './types'

const m = (numerator: number, denominator: number) => ({ numerator, denominator })

describe('feltBeats', () => {
  it('is the numerator for a simple meter', () => {
    expect(feltBeats(m(3, 4))).toBe(3)
    expect(feltBeats(m(4, 4))).toBe(4)
    expect(feltBeats(m(5, 4))).toBe(5)
    expect(feltBeats(m(2, 2))).toBe(2)
    expect(feltBeats(m(2, 4))).toBe(2)
  })

  it('is a third of the numerator for compound meters in eighths: 6/8 is 2, 9/8 is 3, 12/8 is 4', () => {
    expect(feltBeats(m(6, 8))).toBe(2)
    expect(feltBeats(m(9, 8))).toBe(3)
    expect(feltBeats(m(12, 8))).toBe(4)
  })

  it('keeps the numerator for other meters in eighths, and for sixes that are not in eighths', () => {
    expect(feltBeats(m(3, 8))).toBe(3)
    expect(feltBeats(m(5, 8))).toBe(5)
    expect(feltBeats(m(7, 8))).toBe(7)
    expect(feltBeats(m(6, 4))).toBe(6)
    expect(feltBeats(m(6, 16))).toBe(6)
  })
})

describe('sameMeter', () => {
  it('is true for the same numerator and denominator only', () => {
    expect(sameMeter(m(3, 4), m(3, 4))).toBe(true)
    expect(sameMeter(m(3, 4), m(6, 8))).toBe(false)
    expect(sameMeter(m(3, 4), m(2, 4))).toBe(false)
  })
})

describe('heardBeats shares', () => {
  const timingOf = (meters: MeterChange[], extra: Partial<TimingLayer> = {}): TimingLayer => ({
    barCount: 12,
    playOrder: [{ from: 1, to: 12 }],
    meters,
    marks: [],
    locators: [],
    ...extra,
  })
  const slotsOf = (timing: TimingLayer) => expandPlayOrder(timing.playOrder, timing.barCount)

  it('is 1 for every bar when the piece keeps one meter', () => {
    const timing = timingOf([{ fromBar: 1, numerator: 5, denominator: 4 }])
    expect(heardBeats(slotsOf(timing), timing, m(5, 4)).shares).toEqual(Array(12).fill(1))
  })

  it('is 1 with no meters at all', () => {
    const timing = timingOf([])
    expect(heardBeats(slotsOf(timing), timing, m(4, 4)).shares).toEqual(Array(12).fill(1))
  })

  it('gives a 2/4 bar two thirds of a 3/4 bar, and a 3/4 bar one and a half 2/4 bars', () => {
    const timing = timingOf([
      { fromBar: 1, numerator: 3, denominator: 4 },
      { fromBar: 5, numerator: 2, denominator: 4 },
    ])
    const fromThree = heardBeats(slotsOf(timing), timing, m(3, 4)).shares
    expect(fromThree.slice(0, 4)).toEqual([1, 1, 1, 1])
    fromThree.slice(4).forEach((share) => expect(share).toBeCloseTo(2 / 3, 9))
    const fromTwo = heardBeats(slotsOf(timing), timing, m(2, 4)).shares
    fromTwo.slice(0, 4).forEach((share) => expect(share).toBeCloseTo(1.5, 9))
    expect(fromTwo.slice(4)).toEqual(Array(8).fill(1))
  })

  it('counts a 9/8 bar as three felt beats against the two of 6/8', () => {
    const timing = timingOf([
      { fromBar: 1, numerator: 6, denominator: 8 },
      { fromBar: 4, numerator: 9, denominator: 8 },
    ])
    const shares = heardBeats(slotsOf(timing), timing, m(6, 8)).shares
    expect(shares.slice(0, 3)).toEqual([1, 1, 1])
    shares.slice(3).forEach((share) => expect(share).toBeCloseTo(1.5, 9))
  })

  it('times a short bar by its fraction of its own meter: a one-beat pickup in 2/4 is half a bar, a third of a 3/4 bar', () => {
    const timing = timingOf(
      [
        { fromBar: 1, numerator: 3, denominator: 4 },
        { fromBar: 5, numerator: 2, denominator: 4 },
      ],
      { playOrder: [{ from: 0, to: 12 }], shortBars: [{ bar: 0, units: 1 }, { bar: 6, units: 1 }] },
    )
    const shares = heardBeats(slotsOf(timing), timing, m(3, 4)).shares
    // bar 0 is a pickup in 3/4 (the first change covers it): a third of a bar
    expect(shares[0]).toBeCloseTo(1 / 3, 9)
    // bar 6 is one beat of 2/4 (half a 2/4 bar, which is two thirds of a 3/4 bar): a third
    const slot = slotsOf(timing).findIndex((s) => s.bar === 6)
    expect(shares[slot]).toBeCloseTo(1 / 3, 9)
  })

  it('does not change the list of slots or the timing it is given', () => {
    const timing = timingOf([{ fromBar: 1, numerator: 3, denominator: 4 }])
    const copy = JSON.parse(JSON.stringify(timing))
    heardBeats(slotsOf(timing), timing, m(2, 4))
    expect(timing).toEqual(copy)
  })
})

describe('heardBeats snaps', () => {
  const timingOf = (meters: MeterChange[], extra: Partial<TimingLayer> = {}): TimingLayer => ({
    barCount: 12,
    playOrder: [{ from: 1, to: 12 }],
    meters,
    marks: [],
    locators: [],
    ...extra,
  })
  const slotsOf = (timing: TimingLayer) => expandPlayOrder(timing.playOrder, timing.barCount)
  const THREE_THEN_TWO: MeterChange[] = [
    { fromBar: 1, numerator: 3, denominator: 4 },
    { fromBar: 5, numerator: 2, denominator: 4 },
  ]

  it('lets every step snap in a piece of one meter', () => {
    const timing = timingOf([{ fromBar: 1, numerator: 5, denominator: 4 }])
    expect(heardBeats(slotsOf(timing), timing, m(5, 4)).snaps).toEqual(Array(12).fill(true))
  })

  it('does not let a whole bar of another meter snap: its share is exact', () => {
    const timing = timingOf(THREE_THEN_TWO)
    expect(heardBeats(slotsOf(timing), timing, m(3, 4)).snaps).toEqual([true, true, true, true, ...Array(8).fill(false)])
    expect(heardBeats(slotsOf(timing), timing, m(2, 4)).snaps).toEqual([...Array(4).fill(false), ...Array(8).fill(true)])
  })

  it('lets a short bar snap, in the reference meter or in another one', () => {
    const timing = timingOf(THREE_THEN_TWO, { playOrder: [{ from: 0, to: 12 }], shortBars: [{ bar: 0, units: 1 }, { bar: 6, units: 1 }] })
    const slots = slotsOf(timing)
    const snaps = heardBeats(slots, timing, m(3, 4)).snaps
    expect(snaps[0]).toBe(true)
    expect(snaps[slots.findIndex((slot) => slot.bar === 6)]).toBe(true)
    // a whole bar of 2/4 beside them does not
    expect(snaps[slots.findIndex((slot) => slot.bar === 7)]).toBe(false)
  })
})
