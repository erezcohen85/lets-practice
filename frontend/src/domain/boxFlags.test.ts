import { addBarLine, deleteBarLine, moveBarLine, moveLineStart, type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { setBarsInBox } from '@/domain/boxEdits'
import { dropBoxFlag, flagsAfterDelete, flagsAfterInsert, pageWithFlags, shiftFlags } from '@/domain/boxFlags'
import { straightMap } from '@/domain/fixtures'
import { pickupOff } from '@/domain/pickup'
import { deleteBar, insertBar } from '@/domain/renumber'
import { type BoxFlag, type PageLayer } from '@/domain/types'

// The box check's flags ride on the page layer (boxFlags). Every edit that renumbers a part's boxes renumbers its flags the
// way it renumbers its rests; a flag whose bar disappears is dropped; a layer without flags keeps the old shape (no key).

const flag = (bar: number, extra: Partial<BoxFlag> = {}): BoxFlag => ({ bar, verdict: 'two_bars', note: 'n', suggestedX: null, ...extra })

function doc(flags: BoxFlag[]): EditorDoc {
  const { timing, page } = straightMap(8)
  return { timing, pages: [{ ...page, partId: 'flute', boxFlags: flags }, { ...page, partId: 'oboe' }] }
}

function ok(result: EditResult): EditorDoc {
  if (!result.ok) throw new Error(`expected an edit, got a refusal: ${result.reason}`)
  return result.doc
}

const mid = (d: EditorDoc, bar: number) => {
  const box = d.pages[0].bars.find((b) => b.bar === bar)!
  return box.x + box.w / 2
}

const flagBars = (d: EditorDoc, partId = 'flute') => (d.pages.find((p) => p.partId === partId)?.boxFlags ?? []).map((f) => f.bar)

describe('the helpers', () => {
  it('shiftFlags moves every flag by the same amount', () => {
    expect(shiftFlags([flag(1), flag(4)], 1).map((f) => f.bar)).toEqual([2, 5])
  })

  it('flagsAfterInsert moves the flags on or after the new bar up', () => {
    expect(flagsAfterInsert([flag(2), flag(3), flag(5)], 3).map((f) => f.bar)).toEqual([2, 4, 6])
  })

  it('every helper keeps the old edges a flag carries for Put back', () => {
    const previous = { x: 10, w: 90 }
    const read = flag(3, { verdict: 'read_moved', previous })
    expect(shiftFlags([read], 1)[0]).toEqual({ ...read, bar: 4 })
    expect(flagsAfterInsert([read], 2)[0].previous).toBe(previous)
    expect(flagsAfterDelete([flag(1), read], 1)[0]).toEqual({ ...read, bar: 2 })
  })

  it('flagsAfterDelete drops the flag of the deleted bar and moves later ones down', () => {
    expect(flagsAfterDelete([flag(2), flag(3), flag(5)], 3).map((f) => f.bar)).toEqual([2, 4])
  })

  it('pageWithFlags leaves the key out when there are no flags and when there are none left', () => {
    const base = { partId: 'p', bars: [], rests: [] }
    expect(pageWithFlags(base, undefined)).toEqual(base)
    expect('boxFlags' in pageWithFlags(base, [])).toBe(false)
    expect(pageWithFlags(base, [flag(1)]).boxFlags).toEqual([flag(1)])
  })

  it('dropBoxFlag removes the flag of one bar and leaves the key out when it was the last', () => {
    const page: PageLayer = { partId: 'p', bars: [], rests: [], boxFlags: [flag(1), flag(2)] }
    expect(dropBoxFlag(page, 1).boxFlags?.map((f) => f.bar)).toEqual([2])
    expect('boxFlags' in dropBoxFlag(dropBoxFlag(page, 1), 2)).toBe(false)
  })
})

describe('part edits renumber the flags like rests', () => {
  it('Add bar line: flags after the split bar move up, the split bar keeps its flag', () => {
    const edited = ok(addBarLine(doc([flag(2), flag(4)]), 'flute', 2, mid(doc([]), 2)))
    expect(flagBars(edited)).toEqual([2, 5])
  })

  it('Delete bar line: the flag of the bar merged away is dropped, later ones move down', () => {
    const edited = ok(deleteBarLine(doc([flag(2), flag(3), flag(5)]), 'flute', 2))
    expect(flagBars(edited)).toEqual([2, 4])
  })

  it('Move bar line and Move line start keep the flags', () => {
    const before = doc([flag(1), flag(2)])
    const x = before.pages[0].bars[1].x
    expect(flagBars(ok(moveBarLine(before, 'flute', 1, x + 5)))).toEqual([1, 2])
    expect(flagBars(ok(moveLineStart(before, 'flute', 1, 5)))).toEqual([1, 2])
  })

  it('Bars in this box: later flags follow their boxes, flags on dropped bars go', () => {
    const more = ok(setBarsInBox(doc([flag(2), flag(5)]), 'flute', 2, 3))
    expect(flagBars(more)).toEqual([2, 7])
    const fewer = ok(setBarsInBox(more, 'flute', 2, 1))
    expect(flagBars(fewer)).toEqual([2, 5])
  })

  it('another part and a part without flags are untouched', () => {
    const before = doc([flag(2)])
    const edited = ok(addBarLine(before, 'oboe', 2, mid(before, 2)))
    expect(edited.pages[0]).toBe(before.pages[0])
    expect('boxFlags' in edited.pages[1]).toBe(false)
  })
})

describe('the older renumbering', () => {
  it('insertBar and deleteBar renumber the page layer flags', () => {
    const { timing, page } = straightMap(8)
    const flagged: PageLayer = { ...page, boxFlags: [flag(2), flag(4)] }
    const box = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    expect(insertBar(timing, flagged, 3, box, 'plain').page.boxFlags?.map((f) => f.bar)).toEqual([2, 5])
    expect(deleteBar(timing, flagged, 2, 'plain').page.boxFlags?.map((f) => f.bar)).toEqual([3])
  })

  it('the pickup toggle moves the flags with their bars', () => {
    const { timing, page } = straightMap(8)
    const withPickup = {
      timing: { ...timing, shortBars: [{ bar: 0, units: 1 }] },
      pages: [{ ...page, bars: page.bars.map((b) => ({ ...b, bar: b.bar - 1 })), boxFlags: [flag(3)] }],
    }
    expect(flagBars(ok(pickupOff(withPickup)), page.partId)).toEqual([4])
  })
})
