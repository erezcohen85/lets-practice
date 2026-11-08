import { reviewItems } from '@/domain/reviewQueue'
import { applyReviewItems, DEMO_REVIEW_ITEMS, spreadReviewItems, uncheckedItems } from '@/lib/fakes/reviewSeed'
import { DEMO_SPEC, smallSpec, syntheticTiming } from '@/lib/fakes/syntheticPiece'

const demo = () => applyReviewItems(syntheticTiming(DEMO_SPEC), DEMO_REVIEW_ITEMS)
const flagged = (timing = demo()) => timing.locators.filter((l) => (l.flags?.length ?? 0) > 0)
const at = (bar: number) => {
  const found = flagged().find((l) => l.bar === bar)
  if (found === undefined) throw new Error(`bar ${bar} is not flagged`)
  return found
}

describe('the board\'s twelve review items on the demo piece', () => {
  it('flags bars 6, 14, 22, 28, 31, 35, 37, 41, 43, 45, 52 and 60, in play order', () => {
    expect(flagged().map((l) => l.bar)).toEqual([6, 14, 22, 28, 31, 35, 37, 41, 43, 45, 52, 60])
  })

  it('gives each bar the kind of the board', () => {
    const kinds = Object.fromEntries(flagged().map((l) => [l.bar, l.flags?.[0].kind]))

    expect(kinds).toEqual({
      6: 'crowded',
      14: 'beat-count',
      22: 'weak-downbeat',
      28: 'stretched',
      31: 'crowded',
      35: 'beat-count',
      37: 'weak-downbeat',
      41: 'stretched',
      43: 'crowded',
      45: 'beat-count',
      52: 'weak-downbeat',
      60: 'stretched',
    })
  })

  it('checks the first seven and leaves the last five open', () => {
    expect(flagged().map((l) => [l.bar, l.checked === true])).toEqual([
      [6, true], [14, true], [22, true], [28, true], [31, true], [35, true], [37, true],
      [41, false], [43, false], [45, false], [52, false], [60, false],
    ])
  })

  it('explains the stretched bar 28 by its fermata at severity 0, and stretches bar 41 by 1.4', () => {
    expect(at(28).flags?.[0]).toMatchObject({ kind: 'stretched', severity: 0, explainedBy: 'fermata' })
    expect(at(41).flags?.[0]).toMatchObject({ kind: 'stretched', factor: 1.4, explainedBy: null })
  })

  it('gives a weak downbeat the uncertain bar line at the locator\'s time and a crowded bar a factor under 1', () => {
    expect(at(22).flags?.[0].uncertainLine).toEqual({ timeSec: at(22).timeSec, confidence: expect.any(Number) })
    expect(at(22).flags?.[0].uncertainLine?.confidence).toBeLessThan(0.5)
    expect(at(6).flags?.[0].factor).toBeLessThan(1)
    expect(at(14).flags?.[0]).toMatchObject({ expected: 4, found: 3, factor: null })
  })

  it('leaves times and confirmed alone and every other locator untouched', () => {
    const base = syntheticTiming(DEMO_SPEC)

    const after = demo()

    expect(after.locators.map((l) => [l.bar, l.passIndex, l.timeSec, l.confirmed])).toEqual(
      base.locators.map((l) => [l.bar, l.passIndex, l.timeSec, l.confirmed]),
    )
    expect(after.locators.filter((l) => l.flags === undefined)).toEqual(
      base.locators.filter((l) => !flagged(after).some((f) => f.bar === l.bar && f.passIndex === l.passIndex)),
    )
    expect(flagged(after)).toHaveLength(12)
    expect(after.locators.filter((l) => l.flags === undefined && 'checked' in l)).toEqual([])
  })

  it('adds up to 7 of 12 in the Review Queue', () => {
    const items = reviewItems({ timing: demo(), pages: [{ partId: 'p', bars: [], rests: [] }] }, 'none')
      .filter((item) => item.kind === 'flag')

    expect(items).toHaveLength(12)
    expect(items.filter((item) => item.checked)).toHaveLength(7)
  })

  it('unchecks every item of a fresh processing run', () => {
    const fresh = applyReviewItems(syntheticTiming(DEMO_SPEC), uncheckedItems(DEMO_REVIEW_ITEMS))

    expect(flagged(fresh)).toHaveLength(12)
    expect(flagged(fresh).some((l) => l.checked === true)).toBe(false)
  })

  it('leaves an item whose slot does not exist out', () => {
    const items = [{ ...DEMO_REVIEW_ITEMS[0], bar: 90 }]

    expect(flagged(applyReviewItems(syntheticTiming(DEMO_SPEC), items))).toEqual([])
  })
})

describe('spreadReviewItems', () => {
  it('flags the given number of bars from bar 2, the first `checked` of them checked', () => {
    const timing = applyReviewItems(syntheticTiming(smallSpec(200)), spreadReviewItems(5, 2))

    expect(flagged(timing).map((l) => [l.bar, l.checked === true])).toEqual([
      [2, true], [3, true], [4, false], [5, false], [6, false],
    ])
  })

  it('cycles through the four kinds', () => {
    const kinds = spreadReviewItems(5, 0).map((item) => item.kind)

    expect(kinds).toEqual(['crowded', 'stretched', 'beat-count', 'weak-downbeat', 'crowded'])
  })
})
