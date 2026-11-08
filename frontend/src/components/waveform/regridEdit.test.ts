import { regridRefusalText, regridSentence } from '@/components/waveform/regridEdit'
import { done, type EditorDoc } from '@/domain/pieceEdits'
import { type RegridOutcome } from '@/domain/regridEdits'
import { strings } from '@/strings'

// What a regrid says afterwards, in one place: the toolbar's controls, the Ask me panel and the Wrong beat card all use it.

const g = strings.dock.grid
const doc: EditorDoc = { timing: { barCount: 1, playOrder: [{ from: 1, to: 1 }], meters: [], marks: [], locators: [] }, pages: [] }
const outcome = (placed: number, removed: number, dropped: number, spread = 0): RegridOutcome => ({ result: done(doc, { kind: 'regrid' }), placed, removed, dropped, spread })

describe('regridSentence', () => {
  it('says how many lines were placed, removed and dropped', () => {
    expect(regridSentence(outcome(3, 0, 3), null)).toBe(g.done(3, 0, 3))
    expect(regridSentence(outcome(40, 40, 0), null)).toBe('40 bar lines placed on the beats. 40 removed.')
  })

  it('says how many of the lines were spread evenly before the next checked bar line, when some were', () => {
    expect(regridSentence(outcome(11, 0, 0, 4), null)).toBe('11 bar lines placed on the beats. 4 spread evenly before the next checked bar line.')
    expect(regridSentence(outcome(5, 0, 0, 1), null)).toBe('5 bar lines placed on the beats. 1 spread evenly before the next checked bar line.')
    expect(regridSentence(outcome(5, 2, 0, 3), null)).toBe('5 bar lines placed on the beats. 2 removed. 3 spread evenly before the next checked bar line.')
  })

  it('says nothing of spreading when none were', () => {
    expect(regridSentence(outcome(3, 0, 0, 0), null)).toBe(g.done(3, 0, 0))
    expect(regridSentence(outcome(3, 0, 0, 0), null)).not.toMatch(/spread/)
  })

  it('starts with the bars Continue learned from, when it names them', () => {
    expect(regridSentence(outcome(2, 0, 0), { first: '1', last: '4' })).toBe(`${g.continued('1', '4')}${g.done(2, 0, 0)}`)
  })
})

describe('regridRefusalText', () => {
  it('says "nothing would change" for out-of-range and "no room" for no-free-slot, in the regrid\'s own words', () => {
    expect(regridRefusalText('out-of-range')).toBe(g.refusedNothing)
    expect(regridRefusalText('no-free-slot')).toBe(g.refusedNoRoom)
  })

  it('uses the general sentence for any other reason', () => {
    expect(regridRefusalText('duplicate-time')).toBe(strings.review.refusals['duplicate-time'])
  })
})
