import { barsInRange, moveRangeEdge, nudgeRangeEdge, positionNearTime } from '@/domain/rangeEdges'
import { demoDoc } from '@/domain/pieceFixtures'
import { buildTimeline } from '@/domain/tempo'

const timeline = buildTimeline(demoDoc().timing)
const SLOT_SEC = 3.6
const startOf = (position: number) => 1 + SLOT_SEC * position

// Slots of the demo: positions 0-15 are bars 1-16, 16-23 are bars 9-16 again, 24-71 are bars 17-64.
describe('positionNearTime', () => {
  it('is the only position of a bar played once', () => {
    expect(positionNearTime(timeline, 20, 0)).toBe(27)
  })

  it('picks the pass of a repeated bar that holds the time', () => {
    expect(positionNearTime(timeline, 13, startOf(12) + 1)).toBe(12)
    expect(positionNearTime(timeline, 13, startOf(20) + 1)).toBe(20)
  })

  it('picks the pass nearest the time when none holds it', () => {
    expect(positionNearTime(timeline, 13, startOf(30))).toBe(20)
    expect(positionNearTime(timeline, 13, 0)).toBe(12)
  })

  it('is null for a bar that is not played', () => {
    expect(positionNearTime(timeline, 99, 0)).toBeNull()
  })
})

// Bar 13's second time through has no locator, so its time is only an estimate (or the recording's end).
describe('positionNearTime, among the passes that have a time', () => {
  const doc = demoDoc()
  const withoutSecond = buildTimeline({ ...doc.timing, locators: doc.timing.locators.filter((locator) => !(locator.bar === 13 && locator.passIndex === 1)) })

  it('skips a pass with no locator even when it is the nearest', () => {
    expect(positionNearTime(withoutSecond, 13, startOf(21), { timedOnly: true })).toBe(12)
    expect(positionNearTime(withoutSecond, 13, startOf(21))).toBe(20)
  })

  it('is null when no pass of the bar has a locator', () => {
    const none = buildTimeline({ ...doc.timing, locators: doc.timing.locators.filter((locator) => locator.bar !== 13) })
    expect(positionNearTime(none, 13, 0, { timedOnly: true })).toBeNull()
  })
})

describe('barsInRange', () => {
  it('lists the bars the range plays', () => {
    expect([...barsInRange(timeline, { startPosition: 12, endPosition: 14 })]).toEqual([13, 14, 15])
  })

  it('counts a repeated bar once', () => {
    expect(barsInRange(timeline, { startPosition: 14, endPosition: 25 }).size).toBe(10)
  })
})

describe('moveRangeEdge', () => {
  const range = { startPosition: 12, endPosition: 23 }

  it('moves the end to the pass of the bar nearest the old end', () => {
    expect(moveRangeEdge(timeline, range, 'end', 28)).toEqual({ startPosition: 12, endPosition: 35 })
    expect(moveRangeEdge(timeline, range, 'end', 15)).toEqual({ startPosition: 12, endPosition: 22 })
  })

  it('moves the start to the pass of the bar nearest the old start', () => {
    expect(moveRangeEdge(timeline, range, 'start', 10)).toEqual({ startPosition: 9, endPosition: 23 })
    expect(moveRangeEdge(timeline, range, 'start', 14)).toEqual({ startPosition: 13, endPosition: 23 })
  })

  it('keeps the range when the edge would cross the other edge', () => {
    expect(moveRangeEdge(timeline, range, 'end', 3)).toBeNull()
    expect(moveRangeEdge(timeline, range, 'start', 40)).toBeNull()
  })

  it('may leave the edges on one bar', () => {
    expect(moveRangeEdge(timeline, { startPosition: 24, endPosition: 30 }, 'end', 17)).toEqual({ startPosition: 24, endPosition: 24 })
  })

  it('is null for a bar that is not played or an edge that does not move', () => {
    expect(moveRangeEdge(timeline, range, 'end', 99)).toBeNull()
    expect(moveRangeEdge(timeline, range, 'end', 16)).toBeNull()
  })
})

describe('nudgeRangeEdge', () => {
  const range = { startPosition: 12, endPosition: 23 }

  it('moves an edge by whole positions', () => {
    expect(nudgeRangeEdge(timeline, range, 'end', 1)).toEqual({ startPosition: 12, endPosition: 24 })
    expect(nudgeRangeEdge(timeline, range, 'start', -1)).toEqual({ startPosition: 11, endPosition: 23 })
  })

  it('stops at the ends of the piece and at the other edge', () => {
    expect(nudgeRangeEdge(timeline, { startPosition: 0, endPosition: 3 }, 'start', -1)).toBeNull()
    expect(nudgeRangeEdge(timeline, { startPosition: 3, endPosition: timeline.length - 1 }, 'end', 1)).toBeNull()
    expect(nudgeRangeEdge(timeline, { startPosition: 5, endPosition: 5 }, 'end', -1)).toBeNull()
  })
})
