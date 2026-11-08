// Shared synthetic piece for the piece-edit tests. Only test files import this module; the app never does.
import { expandPlayOrder } from './playOrder'
import { type EditorDoc } from './pieceEdits'
import { type BarBox, type Locator, type PageLayer } from './types'

export const DEMO_BAR_COUNT = 64
export const PAGE_WIDTH = 1240
export const PAGE_HEIGHT = 1754
/** The part whose bar line after bar 22 is missing: it has 63 boxes. */
export const SHORT_PART_ID = 'trumpet'
export const MISSED_LINE_AFTER = 22

const BOXES_PER_LINE = 4
const LINES_PER_PAGE = 4
const MARGIN_X = 100
const FIRST_LINE_Y = 150
const BOX_WIDTH = 260
const BOX_HEIGHT = 300
const LINE_PITCH = 380
const FIRST_LOCATOR_SEC = 1
const SEC_PER_SLOT = 3.6

/** Box of a bar in the demo layout: 4 boxes per line touching edge to edge, 4 lines per page, 4 pages. */
function boxOf(bar: number): BarBox {
  const index = bar - 1
  const line = Math.floor(index / BOXES_PER_LINE)
  return {
    bar,
    pageIndex: Math.floor(line / LINES_PER_PAGE),
    x: MARGIN_X + BOX_WIDTH * (index % BOXES_PER_LINE),
    y: FIRST_LINE_Y + LINE_PITCH * (line % LINES_PER_PAGE),
    w: BOX_WIDTH,
    h: BOX_HEIGHT,
  }
}

function completePart(partId: string): PageLayer {
  return { partId, bars: Array.from({ length: DEMO_BAR_COUNT }, (_, i) => boxOf(i + 1)), rests: [] }
}

/** The complete layout with the bar line after `bar` missing: boxes bar and bar + 1 merged, later boxes one lower. */
function partMissingLine(partId: string, bar: number): PageLayer {
  const bars: BarBox[] = []
  for (let n = 1; n <= DEMO_BAR_COUNT; n++) {
    if (n === bar + 1) continue
    const box = boxOf(n)
    if (n === bar) bars.push({ ...box, w: box.w + boxOf(n + 1).w })
    else bars.push({ ...box, bar: n > bar ? n - 1 : n })
  }
  return { partId, bars, rests: [] }
}

/** Slots whose locator is confirmed: both passes of bar 14 sit after the repeat's first bars. */
const CONFIRMED = new Set(['1:0', '14:0', '14:1', '30:0', '64:0'])

/**
 * A 64-bar piece: rows [1-16, 9-16, 17-64] (72 slots), 4/4 then 2/4 from bar 49, a fermata on bar 28, one locator per
 * slot 3.6 s apart, and three parts: clarinet and flute complete, trumpet missing the bar line after bar 22.
 */
export function demoDoc(): EditorDoc {
  const playOrder = [
    { from: 1, to: 16 },
    { from: 9, to: 16 },
    { from: 17, to: DEMO_BAR_COUNT },
  ]
  const locators: Locator[] = expandPlayOrder(playOrder, DEMO_BAR_COUNT).map((slot) => ({
    bar: slot.bar,
    passIndex: slot.passIndex,
    timeSec: FIRST_LOCATOR_SEC + SEC_PER_SLOT * slot.position,
    confirmed: CONFIRMED.has(`${slot.bar}:${slot.passIndex}`),
  }))
  return {
    timing: {
      barCount: DEMO_BAR_COUNT,
      playOrder,
      meters: [
        { fromBar: 1, numerator: 4, denominator: 4 },
        { fromBar: 49, numerator: 2, denominator: 4 },
      ],
      marks: [{ bar: 28, kind: 'fermata' }],
      locators,
    },
    pages: [completePart('clarinet'), partMissingLine(SHORT_PART_ID, MISSED_LINE_AFTER), completePart('flute')],
  }
}
