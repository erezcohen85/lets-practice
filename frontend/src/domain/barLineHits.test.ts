import { barAt, barLineAt, barLines, barUnderPoint, gapBetween, LINE_HIT_RADIUS, lineEdgeAt, lineEndAt, lineEnds, lineStartAt, lineStarts } from './barLineHits'
import { demoDoc, SHORT_PART_ID } from './pieceFixtures'
import { type BarBox } from './types'

const doc = demoDoc()
const clarinet = doc.pages[0].bars
const trumpet = doc.pages.find((page) => page.partId === SHORT_PART_ID)!.bars

describe('barLines', () => {
  it('finds the edge shared by two touching boxes of a line, named by the bar it sits after', () => {
    // Clarinet bars 1-4 are on the first line, x 100 to 1140, 260 wide.
    expect(barLines(clarinet).slice(0, 3)).toEqual([
      { bar: 1, pageIndex: 0, x: 360, y: 150, h: 300 },
      { bar: 2, pageIndex: 0, x: 620, y: 150, h: 300 },
      { bar: 3, pageIndex: 0, x: 880, y: 150, h: 300 },
    ])
  })

  it('leaves out the first and last edge of a line: three lines for four boxes, 48 in all', () => {
    expect(barLines(clarinet)).toHaveLength(48)
    expect(barLines(clarinet).some((line) => line.bar % 4 === 0)).toBe(false)
  })

  it('has one line fewer where a box covers two bars (the trumpet is missing the line after bar 22)', () => {
    expect(barLines(trumpet)).toHaveLength(47)
    // The box of bar 22 spans the printed bars 22 and 23 (x 360 to 880), so there is no line at x 620 on that staff line.
    expect(barLines(trumpet).some((line) => line.pageIndex === 1 && line.y === 530 && line.x === 620)).toBe(false)
  })

  it('does not join boxes on different pages or lines', () => {
    const boxes: BarBox[] = [
      { bar: 1, pageIndex: 0, x: 100, y: 100, w: 200, h: 100 },
      { bar: 2, pageIndex: 1, x: 300, y: 100, w: 200, h: 100 },
      { bar: 3, pageIndex: 1, x: 500, y: 400, w: 200, h: 100 },
    ]

    expect(barLines(boxes)).toEqual([])
  })

  it('treats edges that differ by float noise as one line', () => {
    const boxes: BarBox[] = [
      { bar: 1, pageIndex: 0, x: 100.1, y: 100, w: 250.2, h: 100 },
      { bar: 2, pageIndex: 0, x: 350.30000000000001, y: 100, w: 200, h: 100 },
    ]

    expect(barLines(boxes)).toHaveLength(1)
  })
})

describe('barLines on a deskewed page', () => {
  // A tilted page: the processor's boxes of one line overlap or gap by a pixel or two at the bar lines.
  const pair = (overlap: number): BarBox[] => [
    { bar: 1, pageIndex: 0, x: 100, y: 100, w: 250 + overlap, h: 100 },
    { bar: 2, pageIndex: 0, x: 350, y: 100, w: 250, h: 100 },
  ]

  it('finds a bar line where neighbouring boxes overlap by 0.6 px or by 2 px', () => {
    expect(barLines(pair(0.6))).toEqual([{ bar: 1, pageIndex: 0, x: 350, y: 100, h: 100 }])
    expect(barLines(pair(2))).toEqual([{ bar: 1, pageIndex: 0, x: 350, y: 100, h: 100 }])
  })

  it('finds a bar line where neighbouring boxes leave a 2 px gap', () => {
    const boxes: BarBox[] = [
      { bar: 1, pageIndex: 0, x: 100, y: 100, w: 250, h: 100 },
      { bar: 2, pageIndex: 0, x: 352, y: 100, w: 248, h: 100 },
    ]

    expect(barLines(boxes)).toHaveLength(1)
  })

  it('does not join a multi-rest box to its twin, which has the same x, y, w and h', () => {
    const boxes: BarBox[] = [
      { bar: 1, pageIndex: 0, x: 100, y: 100, w: 250, h: 100 },
      { bar: 2, pageIndex: 0, x: 100, y: 100, w: 250, h: 100 },
    ]

    expect(barLines(boxes)).toEqual([])
  })

  it('still does not join boxes more than a few pixels apart, on other lines or on other pages', () => {
    const boxes: BarBox[] = [
      { bar: 1, pageIndex: 0, x: 100, y: 100, w: 250, h: 100 },
      { bar: 2, pageIndex: 0, x: 356, y: 100, w: 244, h: 100 },
      { bar: 3, pageIndex: 0, x: 600, y: 400, w: 200, h: 100 },
      { bar: 4, pageIndex: 1, x: 800, y: 400, w: 200, h: 100 },
    ]

    expect(barLines(boxes)).toEqual([])
  })

  it('lets the pointer hit such a line', () => {
    expect(barLineAt(pair(0.6), 0, 352, 150)?.bar).toBe(1)
  })
})

describe('barLineAt', () => {
  it('hits within LINE_HIT_RADIUS of the line and covers the height of the line', () => {
    expect(LINE_HIT_RADIUS).toBe(8)

    expect(barLineAt(clarinet, 0, 360, 300)?.bar).toBe(1)
    expect(barLineAt(clarinet, 0, 360 + LINE_HIT_RADIUS, 300)?.bar).toBe(1)
    expect(barLineAt(clarinet, 0, 360 - LINE_HIT_RADIUS, 150)?.bar).toBe(1)
    expect(barLineAt(clarinet, 0, 360 + LINE_HIT_RADIUS + 1, 300)).toBeNull()
    expect(barLineAt(clarinet, 0, 360, 449)?.bar).toBe(1)
    expect(barLineAt(clarinet, 0, 360, 460)).toBeNull()
  })

  it('does not hit the outer edge of a line, or a place where this part has no line', () => {
    expect(barLineAt(clarinet, 0, 100, 300)).toBeNull()
    expect(barLineAt(clarinet, 0, 1140, 300)).toBeNull()
    // The trumpet's staff line with the merged box has no line at x 620 on page 2, though the clarinet's has.
    expect(barLineAt(trumpet, 1, 620, 700)).toBeNull()
    expect(barLineAt(clarinet, 1, 620, 700)?.bar).toBe(22)
    expect(barLineAt(clarinet, 3, 620, 700)?.bar).toBe(54)
  })

  it('picks the line nearest the pointer', () => {
    const boxes: BarBox[] = [
      { bar: 1, pageIndex: 0, x: 100, y: 100, w: 10, h: 100 },
      { bar: 2, pageIndex: 0, x: 110, y: 100, w: 10, h: 100 },
      { bar: 3, pageIndex: 0, x: 120, y: 100, w: 10, h: 100 },
    ]

    expect(barLineAt(boxes, 0, 118, 150)?.bar).toBe(2)
    expect(barLineAt(boxes, 0, 111, 150)?.bar).toBe(1)
  })
})

describe('barAt', () => {
  it('gives the box under the point on that page', () => {
    expect(barAt(clarinet, 0, 400, 200)?.bar).toBe(2)
    expect(barAt(clarinet, 2, 400, 200)?.bar).toBe(34)
  })

  it('gives the box on the right of a shared edge, and nothing outside the boxes', () => {
    expect(barAt(clarinet, 0, 360, 200)?.bar).toBe(2)
    expect(barAt(clarinet, 0, 50, 200)).toBeNull()
    expect(barAt(clarinet, 0, 400, 20)).toBeNull()
  })
})

/** One staff line of three bars: the first starts after a clef (x 100), the third after a time signature (a gap of 40). */
const trimmed: BarBox[] = [
  { bar: 1, pageIndex: 0, x: 100, y: 100, w: 200, h: 100 },
  { bar: 2, pageIndex: 0, x: 300, y: 100, w: 200, h: 100 },
  { bar: 3, pageIndex: 0, x: 540, y: 100, w: 160, h: 100 },
  { bar: 4, pageIndex: 0, x: 60, y: 300, w: 240, h: 100 },
]

describe('a gap between two boxes of a line (a signature printed at the start of a bar)', () => {
  it('measures the gap, or says the boxes are not neighbours', () => {
    expect(gapBetween(trimmed[0], trimmed[1])).toBe(0)
    expect(gapBetween(trimmed[1], trimmed[2])).toBe(40)
    expect(gapBetween(trimmed[2], trimmed[3])).toBeNull()
    expect(gapBetween(trimmed[1], { ...trimmed[2], x: 500 + 300 })).toBeNull()
  })

  it('still has a bar line after the bar, at the right edge of the box before the gap', () => {
    expect(barLines(trimmed)).toEqual([
      { bar: 1, pageIndex: 0, x: 300, y: 100, h: 100 },
      { bar: 2, pageIndex: 0, x: 500, y: 100, h: 100 },
    ])
  })

  it('hits that bar line at the box edge and not at the box that follows the gap', () => {
    expect(barLineAt(trimmed, 0, 500, 150)?.bar).toBe(2)
    expect(barLineAt(trimmed, 0, 540, 150)).toBeNull()
  })

  it('gives a point in the gap to the bar that follows it, but barAt does not', () => {
    expect(barUnderPoint(trimmed, 0, 520, 150)?.bar).toBe(3)
    expect(barAt(trimmed, 0, 520, 150)).toBeNull()
  })
})

describe('the start of a line', () => {
  it('is the left edge of the first box of each staff line', () => {
    expect(lineStarts(trimmed)).toEqual([
      { bar: 1, pageIndex: 0, x: 100, y: 100, h: 100 },
      { bar: 4, pageIndex: 0, x: 60, y: 300, h: 100 },
    ])
  })

  it('names one start for the boxes of a multi-rest, which share a place', () => {
    const rest = [1, 2, 3].map((bar) => ({ bar, pageIndex: 0, x: 100, y: 100, w: 200, h: 100 }))
    expect(lineStarts(rest).map((start) => start.bar)).toEqual([1])
  })

  it('is hit within LINE_HIT_RADIUS of the edge, over the height of the line', () => {
    expect(lineStartAt(trimmed, 0, 100 + LINE_HIT_RADIUS, 150)?.bar).toBe(1)
    expect(lineStartAt(trimmed, 0, 100 - LINE_HIT_RADIUS, 199)?.bar).toBe(1)
    expect(lineStartAt(trimmed, 0, 100 + LINE_HIT_RADIUS + 1, 150)).toBeNull()
    expect(lineStartAt(trimmed, 0, 100, 250)).toBeNull()
    expect(lineStartAt(trimmed, 0, 540, 150)).toBeNull() // the box after a gap is not the start of a line
  })

  it('belongs, with the clef before it, to the first bar of the line', () => {
    expect(barUnderPoint(trimmed, 0, 40, 150)?.bar).toBe(1)
    expect(barUnderPoint(trimmed, 0, 40, 350)?.bar).toBe(4)
  })

  it('does not reach past a few box heights, or onto another line', () => {
    const far: BarBox[] = [{ bar: 1, pageIndex: 0, x: 600, y: 100, w: 200, h: 100 }]

    expect(barUnderPoint(far, 0, 600 - 3 * 100, 150)?.bar).toBe(1)
    expect(barUnderPoint(far, 0, 600 - 3 * 100 - 1, 150)).toBeNull()
    expect(barUnderPoint(trimmed, 0, 10, 250)).toBeNull()
  })

  it('does not take a point in a gap for the bar before it', () => {
    expect(barUnderPoint(trimmed, 0, 720, 150)).toBeNull()
  })
})

describe('the end of a line', () => {
  it('is the right edge of the last box of each staff line', () => {
    expect(lineEnds(trimmed)).toEqual([
      { bar: 3, pageIndex: 0, x: 700, y: 100, h: 100 },
      { bar: 4, pageIndex: 0, x: 300, y: 300, h: 100 },
    ])
  })

  it('is the end of the last box also when a signature gap lies before it', () => {
    expect(lineEnds(trimmed)[0].x).toBe(540 + 160)
    expect(lineEnds(trimmed.slice(0, 2)).map((end) => end.bar)).toEqual([2])
  })

  it('names one end for the boxes of a multi-rest, which share a place', () => {
    const rest = [1, 2, 3].map((bar) => ({ bar, pageIndex: 0, x: 100, y: 100, w: 200, h: 100 }))
    expect(lineEnds(rest).map((end) => end.bar)).toEqual([1])
  })

  it('is the edge of a one-box line too, and a line start is also an end there', () => {
    expect(lineEnds([{ bar: 1, pageIndex: 0, x: 100, y: 100, w: 200, h: 100 }])).toEqual([{ bar: 1, pageIndex: 0, x: 300, y: 100, h: 100 }])
  })

  it('is not an edge a neighbour shares: the line between two touching boxes is not an end', () => {
    expect(lineEnds(trimmed).some((end) => end.bar === 1 || end.bar === 2)).toBe(false)
  })

  it('treats a box that overlaps the next by float noise or by 2 px as having a box after it', () => {
    const pair: BarBox[] = [
      { bar: 1, pageIndex: 0, x: 100, y: 100, w: 252, h: 100 },
      { bar: 2, pageIndex: 0, x: 350, y: 100, w: 250, h: 100 },
    ]
    expect(lineEnds(pair).map((end) => end.bar)).toEqual([2])
  })

  it('is hit within LINE_HIT_RADIUS of the edge, over the height of the line', () => {
    expect(lineEndAt(trimmed, 0, 700 - LINE_HIT_RADIUS, 150)?.bar).toBe(3)
    expect(lineEndAt(trimmed, 0, 700 + LINE_HIT_RADIUS, 199)?.bar).toBe(3)
    expect(lineEndAt(trimmed, 0, 700 + LINE_HIT_RADIUS + 1, 150)).toBeNull()
    expect(lineEndAt(trimmed, 0, 700, 250)).toBeNull()
    expect(lineEndAt(trimmed, 1, 700, 150)).toBeNull()
  })

  it('is not hit at a bar line inside the line or at its start', () => {
    expect(lineEndAt(trimmed, 0, 500, 150)).toBeNull()
    expect(lineEndAt(trimmed, 0, 100, 150)).toBeNull()
  })

  it('the nearer of a start and an end wins on a box narrower than two hit radii', () => {
    const narrow: BarBox[] = [{ bar: 1, pageIndex: 0, x: 100, y: 100, w: 12, h: 100 }]
    expect(lineEdgeAt(narrow, 0, 103, 150)).toMatchObject({ edge: 'start', bar: 1, x: 100 })
    expect(lineEdgeAt(narrow, 0, 109, 150)).toMatchObject({ edge: 'end', bar: 1, x: 112 })
    expect(lineEdgeAt(narrow, 0, 300, 150)).toBeNull()
  })
})
