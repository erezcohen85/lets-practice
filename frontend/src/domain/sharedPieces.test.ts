import { describe, expect, it } from 'vitest'
import { filterShared, ownerChips } from '@/domain/sharedPieces'

const piece = (title: string, ownerName: string, joinedAt: string) => ({ title, ownerName, joinedAt })
const list = [piece('Etude', 'Noa', '2026-11-01'), piece('Waltz', 'Avi', '2026-11-03'), piece('Etude', 'Avi', '2026-11-02')]

describe('ownerChips', () => {
  it('lists each owner once, sorted, with two or more owners', () => {
    expect(ownerChips(list)).toEqual(['Avi', 'Noa'])
  })
  it('is empty with one owner or none', () => {
    expect(ownerChips([list[0]!])).toEqual([])
    expect(ownerChips([])).toEqual([])
  })
})

describe('filterShared', () => {
  it('sorts newest join first', () => {
    expect(filterShared(list, { query: '', owner: null }).map((p) => p.joinedAt)).toEqual(['2026-11-03', '2026-11-02', '2026-11-01'])
  })
  it('filters by owner', () => {
    expect(filterShared(list, { query: '', owner: 'Noa' })).toHaveLength(1)
  })
  it('combines the owner with the search', () => {
    expect(filterShared(list, { query: 'etude', owner: 'Avi' }).map((p) => p.joinedAt)).toEqual(['2026-11-02'])
  })
  it('ignores accents and case, as the search over My pieces does', () => {
    const accented = [piece('Étude Nº 1', 'Noa', '2026-11-01')]
    expect(filterShared(accented, { query: 'etude', owner: null })).toHaveLength(1)
    expect(filterShared([piece('Etude', 'Noa', '2026-11-01')], { query: 'ÉTUDE', owner: null })).toHaveLength(1)
  })
  it('matches several words in any order', () => {
    const pieces = [piece('Clark County Suite', 'Noa', '2026-11-01'), piece('Clark Waltz', 'Noa', '2026-11-02')]
    expect(filterShared(pieces, { query: 'suite clark', owner: null }).map((p) => p.title)).toEqual(['Clark County Suite'])
  })
  it('keeps the same music from two owners as two entries', () => {
    expect(filterShared(list, { query: 'etude', owner: null })).toHaveLength(2)
  })
})
