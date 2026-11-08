import { barNamesOf } from './barNames'
import { expandMarkRows, formatMarkRange, groupMarks, listedMarks, splitListedMarks, type MarkRange } from './markRanges'
import { validateMarks } from './pieceEdits'
import { type ListedMark, type PageLayer, type TimingLayer } from './types'

const bars = (kind: ListedMark['kind'], from: number, to: number): ListedMark[] =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ bar: from + index, kind }))

describe('groupMarks', () => {
  it('turns consecutive bars of one kind into one range', () => {
    expect(groupMarks(bars('rest', 46, 48))).toEqual([{ kind: 'rest', from: 46, to: 48 }])
  })

  it('keeps a single bar as a range of one bar', () => {
    expect(groupMarks([{ bar: 32, kind: 'fermata' }])).toEqual([{ kind: 'fermata', from: 32, to: 32 }])
  })

  it('starts a new range at a gap, a change of kind, or a bar that is out of sequence, keeping the stored order', () => {
    const marks = [...bars('rest', 46, 47), { bar: 49, kind: 'rest' as const }, ...bars('rit', 30, 32), { bar: 33, kind: 'rest' as const }]
    expect(groupMarks(marks)).toEqual([
      { kind: 'rest', from: 46, to: 47 },
      { kind: 'rest', from: 49, to: 49 },
      { kind: 'rit', from: 30, to: 32 },
      { kind: 'rest', from: 33, to: 33 },
    ])
  })

  it('does not join two kinds on the same bar', () => {
    const marks: ListedMark[] = [
      { bar: 5, kind: 'rest' },
      { bar: 5, kind: 'fermata' },
    ]
    expect(groupMarks(marks)).toHaveLength(2)
  })

  it('groups nothing into nothing', () => {
    expect(groupMarks([])).toEqual([])
  })
})

describe('formatMarkRange', () => {
  it('writes "rest 46-48" for a span and "fermata 32" for one bar', () => {
    expect(formatMarkRange({ kind: 'rest', from: 46, to: 48 }, barNamesOf(undefined))).toBe('rest 46-48')
    expect(formatMarkRange({ kind: 'fermata', from: 32, to: 32 }, barNamesOf(undefined))).toBe('fermata 32')
  })
})

describe('expandMarkRows', () => {
  const rows = (...list: MarkRange[]) => list

  it('gives one mark per bar of each row, in order, and remembers the row of each', () => {
    const result = expandMarkRows(rows({ kind: 'rest', from: 46, to: 48 }, { kind: 'fermata', from: 32, to: 32 }))
    expect(result.marks).toEqual([...bars('rest', 46, 48), { bar: 32, kind: 'fermata' }])
    expect(result.rowOf).toEqual([0, 0, 0, 1])
    expect(result.reversed).toEqual([])
  })

  it('is the inverse of groupMarks', () => {
    const marks = [...bars('rest', 46, 48), { bar: 32, kind: 'fermata' as const }, ...bars('rit', 30, 31)]
    expect(expandMarkRows(groupMarks(marks)).marks).toEqual(marks)
  })

  it('reports a row whose first bar comes after its last, and gives it no marks', () => {
    const result = expandMarkRows(rows({ kind: 'rest', from: 48, to: 46 }, { kind: 'rit', from: 3, to: 3 }))
    expect(result.reversed).toEqual([0])
    expect(result.marks).toEqual([{ bar: 3, kind: 'rit' }])
    expect(result.rowOf).toEqual([1])
  })

  it('turns a row that is not a whole number into one mark that validation refuses', () => {
    const result = expandMarkRows(rows({ kind: 'rest', from: NaN, to: NaN }, { kind: 'rest', from: 4, to: NaN }))
    expect(result.rowOf).toEqual([0, 1])
    expect(validateMarks(result.marks, 64).map((error) => error.index)).toEqual([0, 1])
  })

  it('does not expand a span larger than any piece, and leaves validation to refuse its last bar', () => {
    const result = expandMarkRows(rows({ kind: 'rest', from: 1, to: 1_000_000 }))
    expect(result.marks).toEqual([{ bar: 1_000_000, kind: 'rest' }])
    expect(validateMarks(result.marks, 64)).toHaveLength(1)
  })

  it('lets validation find a bar a later row repeats, with the row it sits in', () => {
    const result = expandMarkRows(rows({ kind: 'rest', from: 46, to: 48 }, { kind: 'rest', from: 48, to: 49 }))
    const errors = validateMarks(result.marks, 64)
    expect(errors.map((error) => result.rowOf[error.index])).toEqual([1])
  })
})

describe('listedMarks', () => {
  const timing: TimingLayer = {
    barCount: 64,
    playOrder: [{ from: 1, to: 64 }],
    meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
    marks: [
      { bar: 28, kind: 'fermata' },
      { bar: 30, kind: 'rit' },
    ],
    locators: [],
  }
  const flute: PageLayer = { partId: 'flute', bars: [], rests: [46, 47, 48] }
  const oboe: PageLayer = { partId: 'oboe', bars: [], rests: [3] }

  it('lists the shared marks and then the rests of the part it is given', () => {
    expect(listedMarks(timing, flute)).toEqual([...timing.marks, ...bars('rest', 46, 48)])
    expect(listedMarks(timing, oboe)).toEqual([...timing.marks, { bar: 3, kind: 'rest' }])
  })

  it('lists no rests for a part that is not there, and does not change the timing', () => {
    expect(listedMarks(timing, undefined)).toEqual(timing.marks)
    expect(timing.marks).toHaveLength(2)
  })

  it('writes the rests of a part as one range, as the Marks list and the text show them', () => {
    expect(groupMarks(listedMarks(timing, flute)).map((range) => formatMarkRange(range, barNamesOf(undefined)))).toEqual(['fermata 28', 'rit 30', 'rest 46-48'])
  })
})

describe('splitListedMarks', () => {
  it('sends fermata and rit. to the timing and the bars of the rests to the part, sorted', () => {
    const listed: ListedMark[] = [
      { bar: 9, kind: 'rest' },
      { bar: 4, kind: 'fermata' },
      { bar: 7, kind: 'rest' },
      { bar: 5, kind: 'rit' },
    ]
    expect(splitListedMarks(listed)).toEqual({
      marks: [
        { bar: 4, kind: 'fermata' },
        { bar: 5, kind: 'rit' },
      ],
      rests: [7, 9],
    })
  })

  it('is the inverse of listedMarks', () => {
    const timing: TimingLayer = { barCount: 9, playOrder: [], meters: [], marks: [{ bar: 2, kind: 'rit' }], locators: [] }
    const page: PageLayer = { partId: 'p', bars: [], rests: [3, 4] }
    expect(splitListedMarks(listedMarks(timing, page))).toEqual({ marks: timing.marks, rests: page.rests })
  })
})
