// Inline `type` keeps the import at runtime (verbatimModuleSyntax), so a
// missing module fails this test run too, not only the typecheck.
import {
  DEFAULT_PRACTICE_MEMORY,
  type ClickMode,
  type CountInBars,
  type JobKind,
  type JobStatus,
  type Locator,
  type Part,
  type Piece,
  type PieceMap,
  type TimingLayer,
} from '@/domain/types'

// One valid map: a piece with two parts, a 4-bar timing layer with a repeat
// row (bars 1-2, then 1-4), and one page layer per part.
const map: PieceMap = {
  piece: {
    id: 'piece-1',
    title: 'Sonatina',
    createdAt: '2026-10-29T09:00:00Z',
    role: 'owner',
    ownerName: 'Erez',
    recording: { kind: 'file', urlOrPath: 'sonatina.mp3', durationSec: 24 },
    parts: [
      { id: 'part-violin', name: 'Violin', pageCount: 1 },
      { id: 'part-piano', name: 'Piano', pageCount: 2 },
    ],
    countInBars: 1,
    practice: DEFAULT_PRACTICE_MEMORY,
    lastPartId: null,
  },
  timing: {
    barCount: 4,
    playOrder: [
      { from: 1, to: 2 },
      { from: 1, to: 4 },
    ],
    meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
    marks: [
      { bar: 4, kind: 'fermata' },
      { bar: 3, kind: 'rit' },
    ],
    locators: [
      { bar: 1, passIndex: 0, timeSec: 0, confirmed: true },
      { bar: 2, passIndex: 0, timeSec: 4, confirmed: false },
      { bar: 1, passIndex: 1, timeSec: 8, confirmed: false },
      { bar: 2, passIndex: 1, timeSec: 12, confirmed: false },
      { bar: 3, passIndex: 0, timeSec: 16, confirmed: false },
      { bar: 4, passIndex: 0, timeSec: 20, confirmed: false },
    ],
  },
  pages: [
    {
      partId: 'part-violin',
      bars: [
        { bar: 1, pageIndex: 0, x: 0, y: 0, w: 100, h: 50 },
        { bar: 2, pageIndex: 0, x: 100, y: 0, w: 100, h: 50 },
        { bar: 3, pageIndex: 0, x: 0, y: 50, w: 100, h: 50 },
        { bar: 4, pageIndex: 0, x: 100, y: 50, w: 100, h: 50 },
      ],
      rests: [],
    },
    {
      partId: 'part-piano',
      bars: [
        { bar: 1, pageIndex: 0, x: 0, y: 0, w: 200, h: 80 },
        { bar: 2, pageIndex: 0, x: 0, y: 80, w: 200, h: 80 },
        { bar: 3, pageIndex: 1, x: 0, y: 0, w: 200, h: 80 },
        { bar: 4, pageIndex: 1, x: 0, y: 80, w: 200, h: 80 },
      ],
      rests: [3],
    },
  ],
}

describe('domain types', () => {
  it('describes a piece map with a timing layer and one page layer per part', () => {
    expect(map.timing.locators).toHaveLength(6)
    expect(map.pages).toHaveLength(map.piece.parts.length)
  })

  it('gives a locator a confirmed flag', () => {
    expectTypeOf<Locator>().toHaveProperty('confirmed')
    expectTypeOf<Locator['confirmed']>().toEqualTypeOf<boolean>()
  })

  it('puts one timing layer on the map', () => {
    expectTypeOf<PieceMap['timing']>().toEqualTypeOf<TimingLayer>()
  })

  it('gives a part no colour (Decisions 2026-10-29)', () => {
    expectTypeOf<Part>().toEqualTypeOf<{ id: string; name: string; pageCount: number }>()
  })

  it('remembers the count-in length per piece, 0 meaning off', () => {
    expectTypeOf<Piece['countInBars']>().toEqualTypeOf<CountInBars>()
    expectTypeOf<CountInBars>().toEqualTypeOf<0 | 1 | 2 | 3 | 4>()
  })

  it('remembers the last opened part per piece, null before one was opened', () => {
    expectTypeOf<Piece['lastPartId']>().toEqualTypeOf<string | null>()
  })

  it('has a job kind for adding parts to a piece', () => {
    expectTypeOf<JobKind>().toEqualTypeOf<'process-piece' | 'realign' | 'add-parts'>()
  })

  it('offers two click modes', () => {
    expectTypeOf<ClickMode>().toEqualTypeOf<'plain' | 'ripple'>()
  })

  it('gives a job four statuses', () => {
    expectTypeOf<JobStatus>().toEqualTypeOf<
      'queued' | 'running' | 'done' | 'error'
    >()
  })
})
