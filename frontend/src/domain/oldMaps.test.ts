import { readMap } from './oldMaps'
import { type PageLayer, type TimingLayer } from './types'

const timing = (marks: Array<{ bar: number; kind: string }>) => ({
  barCount: 8,
  playOrder: [{ from: 1, to: 8 }],
  meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
  marks,
  locators: [],
})
const page = (partId: string, rests?: number[]) => ({ partId, bars: [], ...(rests === undefined ? {} : { rests }) })

describe('readMap', () => {
  it('moves the rest marks of an older timing to every part and keeps fermata and rit.', () => {
    const map = readMap({
      timing: timing([
        { bar: 2, kind: 'rest' },
        { bar: 3, kind: 'rest' },
        { bar: 5, kind: 'fermata' },
        { bar: 6, kind: 'rit' },
      ]),
      pages: { flute: page('flute'), oboe: page('oboe') },
    })

    expect(map.timing.marks).toEqual([
      { bar: 5, kind: 'fermata' },
      { bar: 6, kind: 'rit' },
    ])
    expect(map.pages.flute.rests).toEqual([2, 3])
    expect(map.pages.oboe.rests).toEqual([2, 3])
  })

  it('adds the old rests to the rests a part has already, sorted and once each', () => {
    const map = readMap({
      timing: timing([
        { bar: 4, kind: 'rest' },
        { bar: 5, kind: 'rest' },
      ]),
      pages: { flute: page('flute', [1, 5]), oboe: page('oboe', []) },
    })

    expect(map.pages.flute.rests).toEqual([1, 4, 5])
    expect(map.pages.oboe.rests).toEqual([4, 5])
  })

  it('reads a page layer without rests as having none', () => {
    const map = readMap({ timing: timing([]), pages: { flute: page('flute') } })

    expect(map.pages.flute.rests).toEqual([])
  })

  it('leaves a map in today\'s shape as it is, down to the references', () => {
    const current: { timing: TimingLayer; pages: Record<string, PageLayer> } = {
      timing: { ...timing([{ bar: 5, kind: 'fermata' }]), marks: [{ bar: 5, kind: 'fermata' }] },
      pages: { flute: { partId: 'flute', bars: [], rests: [2] } },
    }

    const map = readMap(current)

    expect(map.timing).toBe(current.timing)
    expect(map.pages.flute).toBe(current.pages.flute)
  })

  it('does not change what it is given', () => {
    const old = { timing: timing([{ bar: 2, kind: 'rest' }]), pages: { flute: page('flute') } }
    const before = JSON.stringify(old)

    readMap(old)

    expect(JSON.stringify(old)).toBe(before)
  })
})
