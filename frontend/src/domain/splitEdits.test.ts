import {
  canMoveBoundary,
  keptCount,
  mergeWithNext,
  moveBoundary,
  numberDuplicates,
  partsToKeep,
  renameSplitPart,
  setKeep,
  splitAtPage,
  splitIsValid,
  splitProblems,
  canSkipPage,
  canSplitAt,
  keptPageCount,
  pageRuns,
  toggleSkipPage,
  type SplitPart,
} from '@/domain/splitEdits'

const part = (name: string, fromPage: number, toPage: number, keep = true, skipPages: number[] = []): SplitPart => ({ name, fromPage, toPage, keep, skipPages })

const THREE = [part('Flute', 1, 2), part('Oboe', 3, 3), part('Clarinet', 4, 6)]
const ranges = (parts: SplitPart[]) => parts.map((entry) => [entry.fromPage, entry.toPage])

/** Every page once, in order, each part at least one page: what every edit must leave behind. */
function expectCovers(parts: SplitPart[], pageCount: number) {
  let next = 1
  for (const entry of parts) {
    expect(entry.fromPage).toBe(next)
    expect(entry.toPage).toBeGreaterThanOrEqual(entry.fromPage)
    next = entry.toPage + 1
  }
  expect(next).toBe(pageCount + 1)
}

describe('numberDuplicates', () => {
  it('leaves distinct names alone', () => {
    expect(numberDuplicates(THREE).map((entry) => entry.name)).toEqual(['Flute', 'Oboe', 'Clarinet'])
  })

  it('numbers a repeated name from the second one: Violin, Violin (2), Violin (3)', () => {
    const parts = [part('Violin', 1, 2), part('Viola', 3, 3), part('Violin', 4, 5), part('Violin', 6, 6)]
    expect(numberDuplicates(parts).map((entry) => entry.name)).toEqual(['Violin', 'Viola', 'Violin (2)', 'Violin (3)'])
  })

  it('skips a number that is already a name, and compares names without case or outer spaces', () => {
    const parts = [part('Violin', 1, 1), part(' violin ', 2, 2), part('Violin (2)', 3, 3)]
    expect(numberDuplicates(parts).map((entry) => entry.name)).toEqual(['Violin', 'violin (3)', 'Violin (2)'])
  })

  it('keeps the whole name inside 80 characters', () => {
    const long = 'x'.repeat(80)
    const [, second] = numberDuplicates([part(long, 1, 1), part(long, 2, 2)])
    expect(second.name).toHaveLength(80)
    expect(second.name.endsWith(' (2)')).toBe(true)
  })
})

describe('renameSplitPart and setKeep', () => {
  it('change one entry and leave the list they were given as it was', () => {
    expect(renameSplitPart(THREE, 1, ' Oboe 1 ')[1].name).toBe(' Oboe 1 ')
    expect(setKeep(THREE, 2, false)[2].keep).toBe(false)
    expect(THREE[1].name).toBe('Oboe')
    expect(THREE[2].keep).toBe(true)
  })
})

describe('moveBoundary', () => {
  it('+1 gives the next part\'s first page to this part', () => {
    const parts = [part('Flute', 1, 2), part('Oboe', 3, 5)]
    expect(ranges(moveBoundary(parts, 0, 1))).toEqual([[1, 3], [4, 5]])
  })

  it('-1 gives this part\'s last page to the next part', () => {
    const parts = [part('Flute', 1, 2), part('Oboe', 3, 5)]
    expect(ranges(moveBoundary(parts, 0, -1))).toEqual([[1, 1], [2, 5]])
  })

  it('cannot take the only page of a part, and leaves the list as it was', () => {
    expect(canMoveBoundary(THREE, 0, 1)).toBe(false) // Oboe is page 3 only
    expect(canMoveBoundary(THREE, 0, -1)).toBe(true)
    expect(canMoveBoundary(THREE, 1, 1)).toBe(true) // Clarinet has pages 4-6
    expect(canMoveBoundary(THREE, 1, -1)).toBe(false)
    expect(canMoveBoundary([part('A', 1, 1), part('B', 2, 2)], 0, 1)).toBe(false)
    expect(canMoveBoundary([part('A', 1, 1), part('B', 2, 2)], 0, -1)).toBe(false)
    const same = [part('A', 1, 1), part('B', 2, 2)]
    expect(moveBoundary(same, 0, 1)).toEqual(same)
  })

  it('has no boundary after the last part', () => {
    expect(canMoveBoundary(THREE, 2, 1)).toBe(false)
    expect(canMoveBoundary(THREE, 2, -1)).toBe(false)
  })

  it('keeps every page covered once', () => {
    expectCovers(moveBoundary(moveBoundary(THREE, 0, 1), 1, -1), 6)
  })
})

describe('mergeWithNext', () => {
  it('joins a part and the next one under the first name', () => {
    const merged = mergeWithNext(THREE, 0)
    expect(merged.map((entry) => entry.name)).toEqual(['Flute', 'Clarinet'])
    expect(ranges(merged)).toEqual([[1, 3], [4, 6]])
    expectCovers(merged, 6)
  })

  it('is kept when either of the two was kept, so no page the user wanted is dropped', () => {
    expect(mergeWithNext([part('A', 1, 1, false), part('B', 2, 2, true)], 0)[0].keep).toBe(true)
    expect(mergeWithNext([part('A', 1, 1, false), part('B', 2, 2, false)], 0)[0].keep).toBe(false)
  })

  it('does nothing for the last part', () => {
    expect(mergeWithNext(THREE, 2)).toEqual(THREE)
  })
})

describe('splitAtPage', () => {
  it('starts a new part at the page, named "<name> (2)"', () => {
    const split = splitAtPage(THREE, 2, 5)
    expect(split.map((entry) => entry.name)).toEqual(['Flute', 'Oboe', 'Clarinet', 'Clarinet (2)'])
    expect(ranges(split)).toEqual([[1, 2], [3, 3], [4, 4], [5, 6]])
    expectCovers(split, 6)
  })

  it('takes the next free number', () => {
    const parts = [part('Violin', 1, 2), part('Violin (2)', 3, 3), part('Viola', 4, 6)]
    expect(splitAtPage(parts, 0, 2).map((entry) => entry.name)).toEqual(['Violin', 'Violin (3)', 'Violin (2)', 'Viola'])
  })

  it('counts from the name without its own number: "Violin (2)" gives "Violin (3)"', () => {
    const parts = [part('Violin', 1, 1), part('Violin (2)', 2, 4)]
    expect(splitAtPage(parts, 1, 3).map((entry) => entry.name)).toEqual(['Violin', 'Violin (2)', 'Violin (3)'])
  })

  it('does nothing at the first page of a part or outside it (a part needs at least one page)', () => {
    expect(splitAtPage(THREE, 0, 1)).toEqual(THREE)
    expect(splitAtPage(THREE, 0, 3)).toEqual(THREE)
    expect(splitAtPage(THREE, 1, 3)).toEqual(THREE)
  })

  it('gives the new part the keep state of the part it came from', () => {
    expect(splitAtPage([part('A', 1, 3, false)], 0, 2)[1].keep).toBe(false)
  })
})

describe('partsToKeep and keptCount', () => {
  it('sends the kept parts only, in page order, trimmed, as the server reads them', () => {
    const parts = [part(' Flute ', 1, 2), part('Cover', 3, 3, false), part('Clarinet', 4, 6)]
    expect(keptCount(parts)).toBe(2)
    expect(partsToKeep(parts)).toEqual([
      { name: 'Flute', fromPage: 1, toPage: 2, skipPages: [] },
      { name: 'Clarinet', fromPage: 4, toPage: 6, skipPages: [] },
    ])
  })

  it('sends the skipped pages of a kept part along with its range', () => {
    expect(partsToKeep([part('Flute', 1, 5, true, [2, 4])])).toEqual([{ name: 'Flute', fromPage: 1, toPage: 5, skipPages: [2, 4] }])
  })
})

describe('skipped pages', () => {
  it('pageRuns lists the pages that stay as runs: 1-3, 5-6', () => {
    expect(pageRuns(part('A', 1, 6, true, [4]))).toEqual([[1, 3], [5, 6]])
    expect(pageRuns(part('A', 1, 3))).toEqual([[1, 3]])
    expect(pageRuns(part('A', 1, 5, true, [2, 4]))).toEqual([[1, 1], [3, 3], [5, 5]])
    expect(pageRuns(part('A', 1, 3, true, [1]))).toEqual([[2, 3]])
  })

  it('keptPageCount is the range without the skipped pages', () => {
    expect(keptPageCount(part('A', 3, 7, true, [4, 7]))).toBe(3)
  })

  it('toggleSkipPage discards a page, keeps the list sorted, and restores it on the second press', () => {
    const once = toggleSkipPage([part('A', 1, 6)], 0, 5)
    const twice = toggleSkipPage(once, 0, 2)
    expect(twice[0].skipPages).toEqual([2, 5])
    expect(toggleSkipPage(twice, 0, 5)[0].skipPages).toEqual([2])
  })

  it('does not change the list it was given', () => {
    const parts = [part('A', 1, 3)]
    toggleSkipPage(parts, 0, 2)
    expect(parts[0].skipPages).toEqual([])
  })

  it('cannot discard the last kept page of a part, but can always restore', () => {
    const two = part('A', 1, 2, true, [1])
    expect(canSkipPage(two, 2)).toBe(false)
    expect(toggleSkipPage([two], 0, 2)).toEqual([two])
    expect(canSkipPage(part('A', 4, 4), 4)).toBe(false)
    expect(canSkipPage(part('A', 1, 3), 3)).toBe(true)
    expect(toggleSkipPage([two], 0, 1)[0].skipPages).toEqual([])
  })

  it('ignores a page outside the part', () => {
    expect(canSkipPage(part('A', 2, 4), 5)).toBe(false)
    expect(toggleSkipPage([part('A', 2, 4)], 0, 1)[0].skipPages).toEqual([])
  })

  it('moving a boundary takes the skip along with its page', () => {
    const parts = [part('Flute', 1, 2), part('Oboe', 3, 5, true, [3, 5])]
    const down = moveBoundary(parts, 0, 1)
    expect(down[0].skipPages).toEqual([3])
    expect(down[1].skipPages).toEqual([5])
    const up = moveBoundary(down, 0, -1)
    expect(up[0].skipPages).toEqual([])
    expect(up[1].skipPages).toEqual([3, 5])
  })

  it('a part cannot give away its last kept page, even though other pages are left', () => {
    // A keeps only page 2; giving it away would leave page 1, which is skipped
    const parts = [part('A', 1, 2, true, [1]), part('B', 3, 4)]
    expect(canMoveBoundary(parts, 0, -1)).toBe(false)
    expect(moveBoundary(parts, 0, -1)).toEqual(parts)
    // B keeps only page 3; giving it away to A would leave page 4, which is skipped
    expect(canMoveBoundary([part('A', 1, 1), part('B', 3, 4, true, [4])], 0, 1)).toBe(false)
  })

  it('a part can give away a skipped page while a kept page stays', () => {
    expect(canMoveBoundary([part('A', 1, 2, true, [2]), part('B', 3, 4)], 0, -1)).toBe(true)
    expect(canMoveBoundary([part('A', 1, 2), part('B', 3, 4, true, [3])], 0, 1)).toBe(true)
  })

  it('merging keeps the skips of both parts', () => {
    const merged = mergeWithNext([part('A', 1, 3, true, [2]), part('B', 4, 6, true, [6])], 0)
    expect(merged[0].skipPages).toEqual([2, 6])
  })

  it('starting a part at a page hands each side the skips of its pages', () => {
    const split = splitAtPage([part('A', 1, 6, true, [2, 5])], 0, 4)
    expect(split.map((entry) => entry.skipPages)).toEqual([[2], [5]])
    expectCovers(split, 6)
  })

  it('does not start a part that would have only skipped pages', () => {
    const parts = [part('A', 1, 3, true, [1])]
    expect(canSplitAt(parts, 0, 2)).toBe(false) // page 1 alone would be skipped
    expect(splitAtPage(parts, 0, 2)).toEqual(parts)
    expect(canSplitAt([part('A', 1, 3, true, [3])], 0, 3)).toBe(false)
    expect(canSplitAt([part('A', 1, 3, true, [2])], 0, 3)).toBe(true)
  })
})

describe('splitProblems', () => {
  it('finds nothing wrong with a good split', () => {
    expect(splitProblems(THREE)).toEqual({ names: {}, kept: null })
  })

  it('wants at least one part kept', () => {
    expect(splitProblems([part('A', 1, 1, false)]).kept).toBe('none')
  })

  it('has no limit on the number of kept parts', () => {
    const many = Array.from({ length: 120 }, (_, index) => part(`P${index}`, index + 1, index + 1))
    expect(splitProblems(many)).toEqual({ names: {}, kept: null })
    expect(splitIsValid(splitProblems(many))).toBe(true)
  })

  it('wants a name of 1 to 80 characters on each kept part, by index', () => {
    const parts = [part('  ', 1, 1), part('ok', 2, 2), part('x'.repeat(81), 3, 3), part('', 4, 4, false), part('x'.repeat(80), 5, 5)]
    expect(splitProblems(parts).names).toEqual({ 0: 'empty', 2: 'too-long' })
  })
})
