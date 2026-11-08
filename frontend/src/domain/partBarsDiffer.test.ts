import { partBarsDiffer, type EditorDoc } from './pieceEdits'
import { demoDoc } from './pieceFixtures'
import { pickupOn } from './pickup'

// Whether a part's bars still need fixing against the piece: a different count, or the piece's pickup box missing.
// The Structure strip keeps its This part tabs for as long as this is true.

function withPage(doc: EditorDoc, partId: string, change: (bars: EditorDoc['pages'][number]['bars']) => EditorDoc['pages'][number]['bars']): EditorDoc {
  return { ...doc, pages: doc.pages.map((page) => (page.partId === partId ? { ...page, bars: change(page.bars) } : page)) }
}

function pickupDoc(): EditorDoc {
  const result = pickupOn(demoDoc())
  if (!result.ok) throw new Error('refused')
  return result.doc
}

describe('partBarsDiffer', () => {
  it('is false for a part with the piece\'s bars', () => {
    expect(partBarsDiffer(demoDoc(), 'clarinet')).toBe(false)
    expect(partBarsDiffer(pickupDoc(), 'clarinet')).toBe(false)
  })

  it('is true when the part has another number of bars', () => {
    expect(partBarsDiffer(withPage(demoDoc(), 'clarinet', (bars) => bars.slice(0, -1)), 'clarinet')).toBe(true)
  })

  it('is true when the piece has a pickup and the part has no box for it, even with the same count', () => {
    const doc = withPage(pickupDoc(), 'clarinet', (bars) => {
      const without = bars.filter((box) => box.bar !== 0)
      return [...without, { ...without[without.length - 1], bar: without[without.length - 1].bar + 1 }]
    })
    expect(doc.pages.find((page) => page.partId === 'clarinet')!.bars).toHaveLength(pickupDoc().pages.find((page) => page.partId === 'clarinet')!.bars.length)
    expect(partBarsDiffer(doc, 'clarinet')).toBe(true)
  })

})
