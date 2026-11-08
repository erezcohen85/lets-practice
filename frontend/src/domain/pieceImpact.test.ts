import { barCountAdvice, pieceImpact } from '@/domain/pieceImpact'
import { setBarsInBox, setBarsInBoxInPiece } from '@/domain/boxEdits'
import { straightMap } from '@/domain/fixtures'
import { insertPieceBar, type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { type PageLayer } from '@/domain/types'

// A piece of 8 bars and `parts` parts of 8 boxes each; `short` names parts that have only 7.
function doc(parts: number, short: string[] = []): EditorDoc {
  const { timing, page } = straightMap(8)
  const pages: PageLayer[] = Array.from({ length: parts }, (_, i) => {
    const partId = `p${i + 1}`
    return { partId, bars: short.includes(partId) ? page.bars.slice(0, 7) : page.bars, rests: [] }
  })
  return { timing, pages }
}

function ok(result: EditResult): Extract<EditResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected an edit, got a refusal: ${result.reason}`)
  return result
}

describe('pieceImpact', () => {
  it('a piece edit from one part leaves every other part one bar off', () => {
    const before = doc(14)
    const result = ok(setBarsInBoxInPiece(before, 'p1', 3, 2, 'ripple'))

    const impact = pieceImpact(before, result)

    expect(impact.barsAdded).toBe(1)
    expect(impact.barsRemoved).toBe(0)
    expect(impact.partsOff).toHaveLength(13)
    expect(impact.partsOff[0]).toEqual({ partId: 'p2', diff: -1 })
  })

  it('an insert in the piece only leaves every part off', () => {
    const before = doc(14)
    expect(pieceImpact(before, ok(insertPieceBar(before, 4, 'ripple'))).partsOff).toHaveLength(14)
  })

  it('a part edit changes no bars of the piece and lists only parts that are off', () => {
    const before = doc(3)
    const impact = pieceImpact(before, ok(setBarsInBox(before, 'p1', 3, 2)))

    expect(impact.barsAdded + impact.barsRemoved).toBe(0)
    expect(impact.partsOff).toEqual([{ partId: 'p1', diff: 1 }])
  })

  it('counts the times a plain insert drops', () => {
    const before = doc(2)
    const result = ok(insertPieceBar(before, 4, 'plain'))
    expect(pieceImpact(before, result).timesDropped).toBe(result.droppedLocators.length)
  })
})

describe('barCountAdvice', () => {
  it('is null for a part that matches the piece', () => {
    expect(barCountAdvice(doc(3), 'p1')).toBeNull()
  })

  it('calls a part misread when most other parts agree with the piece (the Los Banditos Tubas)', () => {
    expect(barCountAdvice(doc(14, ['p12']), 'p12')).toEqual({
      partBars: 7,
      pieceBars: 8,
      diff: -1,
      agreeWithPiece: 13,
      agreeWithPart: 0,
      others: 13,
      kind: 'part-misread',
    })
  })

  it('says the piece may be wrong when more than half of the other parts have this part count', () => {
    const shorts = Array.from({ length: 12 }, (_, i) => `p${i + 1}`)
    expect(barCountAdvice(doc(14, shorts), 'p1')?.kind).toBe('piece-may-be-wrong')
  })

  it('calls the part misread when nobody agrees with anybody', () => {
    expect(barCountAdvice(doc(1, ['p1']), 'p1')?.kind).toBe('single-part')
    const mixed = doc(3, ['p1'])
    mixed.pages[1] = { ...mixed.pages[1], bars: mixed.pages[1].bars.slice(0, 6) }
    mixed.pages[2] = { ...mixed.pages[2], bars: mixed.pages[2].bars.slice(0, 5) }
    expect(barCountAdvice(mixed, 'p1')?.kind).toBe('part-misread')
  })
})
