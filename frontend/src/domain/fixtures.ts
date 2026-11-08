// Shared synthetic maps for the domain tests. Only test files import this module; the app never does.
import { expect } from 'vitest'
import { expandPlayOrder } from './playOrder'
import { type BarBox, type Locator, type PageLayer, type PlayOrderRow, type TimingLayer } from './types'

const FIRST_LOCATOR_SEC = 1
const SEC_PER_SLOT = 2
const BOXES_PER_LINE = 4
const LINES_PER_PAGE = 2
const PART_ID = 'part-1'

/** Box of a bar in the synthetic layout: 4 boxes per line, 2 lines per page, 400 x 200 px each. */
function boxOf(bar: number): BarBox {
  const index = bar - 1
  const line = Math.floor(index / BOXES_PER_LINE)
  return {
    bar,
    pageIndex: Math.floor(line / LINES_PER_PAGE),
    x: 100 + 400 * (index % BOXES_PER_LINE),
    y: 200 + 300 * (line % LINES_PER_PAGE),
    w: 400,
    h: 200,
  }
}

function pageLayer(barCount: number): PageLayer {
  return { partId: PART_ID, bars: Array.from({ length: barCount }, (_, i) => boxOf(i + 1)), rests: [] }
}

/** A map in 4/4 whose play order has one locator per slot, 2 s apart from 1.0 s, none confirmed. */
function buildMap(barCount: number, playOrder: PlayOrderRow[]): { timing: TimingLayer; page: PageLayer } {
  const locators: Locator[] = expandPlayOrder(playOrder, barCount).map((slot) => ({
    bar: slot.bar,
    passIndex: slot.passIndex,
    timeSec: FIRST_LOCATOR_SEC + SEC_PER_SLOT * slot.position,
    confirmed: false,
  }))
  return {
    timing: {
      barCount,
      playOrder: playOrder.map((row) => ({ ...row })),
      meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
      marks: [],
      locators,
    },
    page: pageLayer(barCount),
  }
}

/** n bars of 4/4 played straight through, one locator per bar at 1, 3, 5, ... seconds. */
export function straightMap(n: number): { timing: TimingLayer; page: PageLayer } {
  return buildMap(n, [{ from: 1, to: n }])
}

/** 8 bars, rows [1-4, 1-4, 5-8], 12 slots with one locator each at 1, 3, 5, ... 23 seconds. */
export function repeatMap(): { timing: TimingLayer; page: PageLayer } {
  return buildMap(8, [
    { from: 1, to: 4 },
    { from: 1, to: 4 },
    { from: 5, to: 8 },
  ])
}

/** 12 bars, rows [1-8, 1-7, 9-12] (bar 8 = 1st ending, bar 9 = 2nd ending), 19 slots 2 s apart. */
export function voltaMap(): { timing: TimingLayer; page: PageLayer } {
  return buildMap(12, [
    { from: 1, to: 8 },
    { from: 1, to: 7 },
    { from: 9, to: 12 },
  ])
}

/** Asserts that every locator sits on a real slot and that time strictly increases along the play order. */
export function expectOrdered(timing: TimingLayer): void {
  const positions = new Map(
    expandPlayOrder(timing.playOrder, timing.barCount).map((slot) => [`${slot.bar}:${slot.passIndex}`, slot.position]),
  )
  const located = timing.locators.map((locator) => {
    const position = positions.get(`${locator.bar}:${locator.passIndex}`)
    if (position === undefined) {
      expect.unreachable(`locator (bar ${locator.bar}, pass ${locator.passIndex}) has no slot in the play order`)
    }
    return { position, locator }
  })
  located.sort((a, b) => a.position - b.position)
  for (let i = 1; i < located.length; i++) {
    const before = located[i - 1]
    const after = located[i]
    expect(after.position, 'two locators share one slot').toBeGreaterThan(before.position)
    expect(
      after.locator.timeSec,
      `time of (bar ${after.locator.bar}, pass ${after.locator.passIndex}) must exceed the one before it`,
    ).toBeGreaterThan(before.locator.timeSec)
  }
}
