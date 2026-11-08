import { playedBarCount, repeatedRanges } from './playOrderSummary'

describe('playedBarCount', () => {
  it('adds up the bars of every row', () => {
    expect(playedBarCount([{ from: 1, to: 16 }, { from: 9, to: 16 }, { from: 17, to: 64 }])).toBe(72)
    expect(playedBarCount([])).toBe(0)
  })
})

describe('repeatedRanges', () => {
  it('names the bars that are played more than once, joined into ranges', () => {
    const rows = [{ from: 1, to: 16 }, { from: 9, to: 16 }, { from: 17, to: 64 }]
    expect(repeatedRanges(rows)).toEqual([{ from: 9, to: 16, times: 2 }])
  })

  it('counts a third pass and splits a range where the count changes', () => {
    const rows = [{ from: 1, to: 16 }, { from: 9, to: 16 }, { from: 9, to: 12 }]
    expect(repeatedRanges(rows)).toEqual([
      { from: 9, to: 12, times: 3 },
      { from: 13, to: 16, times: 2 },
    ])
  })

  it('lists separate ranges apart and is empty for a straight run', () => {
    expect(repeatedRanges([{ from: 1, to: 8 }, { from: 1, to: 2 }, { from: 5, to: 6 }, { from: 5, to: 6 }])).toEqual([
      { from: 1, to: 2, times: 2 },
      { from: 5, to: 6, times: 3 },
    ])
    expect(repeatedRanges([{ from: 1, to: 64 }])).toEqual([])
  })
})
