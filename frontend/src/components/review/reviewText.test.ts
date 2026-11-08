import { chipsOf, explanationOf } from '@/components/review/reviewText'
import { type ReviewItem } from '@/domain/reviewQueue'
import { type ReviewFlag } from '@/domain/types'
import { strings } from '@/strings'
import { barNamesOf } from '@/domain/barNames'

const text = strings.review

const flag = (rest: Partial<ReviewFlag>): ReviewFlag => ({
  kind: 'stretched',
  severity: 1,
  expected: 4.1,
  found: 5.74,
  factor: 1.4,
  explainedBy: null,
  uncertainLine: null,
  ...rest,
})
const item = (flags: ReviewFlag[], rest: Partial<Extract<ReviewItem, { kind: 'flag' }>> = {}): Extract<ReviewItem, { kind: 'flag' }> => ({
  kind: 'flag',
  bar: 41,
  passIndex: 0,
  timeSec: 102.3,
  flags,
  checked: false,
  moved: false,
  ...rest,
})
const sentences = (it: ReviewItem) => explanationOf(it, { partName: 'Clarinet', movedBySec: null, names: barNamesOf(undefined) })

describe('chips', () => {
  it('names each flag kind, with the stretch factor to one decimal', () => {
    expect(chipsOf(item([flag({ kind: 'crowded', factor: 0.56 })])).map((chip) => chip.label)).toEqual(['Crowded'])
    expect(chipsOf(item([flag({})])).map((chip) => chip.label)).toEqual(['Stretched 1.4x'])
    expect(chipsOf(item([flag({ kind: 'beat-count', factor: null })])).map((chip) => chip.label)).toEqual(['Beat count'])
    expect(chipsOf(item([flag({ kind: 'weak-downbeat', factor: null })])).map((chip) => chip.label)).toEqual(['Weak downbeat'])
    expect(chipsOf(item([flag({ kind: 'other-downbeat', factor: 0.9 })])).map((chip) => chip.label)).toEqual(['Other downbeat'])
    expect(chipsOf(item([flag({ kind: 'pickup', expected: 2, found: 1, factor: null })])).map((chip) => chip.label)).toEqual(['Pickup?'])
  })

  it('says "Explained by score" for a severity-0 flag, "Moved" for a moved item without flags', () => {
    expect(chipsOf(item([flag({ severity: 0, explainedBy: 'fermata' })])).map((chip) => chip.label)).toEqual(['Explained by score'])
    expect(chipsOf(item([], { moved: true })).map((chip) => chip.label)).toEqual(['Moved'])
  })

  it('shows only the flag chip on a moved item that has flags, so the header holds a single chip', () => {
    expect(chipsOf(item([flag({})], { moved: true })).map((chip) => chip.label)).toEqual(['Stretched 1.4x'])
  })

  it('says "No time yet" for an unmatched bar and "Bar count" for a part', () => {
    expect(chipsOf({ kind: 'unmatched', bar: 3, passIndex: 0 }).map((chip) => chip.label)).toEqual(['No time yet'])
    expect(chipsOf({ kind: 'part', problem: { kind: 'bar-count', partBars: 63, pieceBars: 64 } }).map((chip) => chip.label)).toEqual(['Bar count'])
  })
})

describe('explanations', () => {
  it('works the sentence out from the numbers', () => {
    expect(sentences(item([flag({})]))).toEqual(['Bar 41 is 1.4x longer than the bars around it.'])
    expect(sentences(item([flag({ kind: 'crowded', factor: 0.56 })]))).toEqual(['Bar 41 is 1.8x shorter than the bars around it.'])
    expect(sentences(item([flag({ kind: 'beat-count', expected: 4, found: 5, factor: null })]))).toEqual(['5 beats heard, 4 notated.'])
    expect(
      sentences(item([flag({ kind: 'weak-downbeat', factor: null, uncertainLine: { timeSec: 102.3, confidence: 0.24 } })])),
    ).toEqual(['The downbeat is weak (24%).'])
  })

  it('says where the other downbeat reading is and how strong each is, once', () => {
    const other = flag({ kind: 'other-downbeat', expected: 0.66, found: 0.94, factor: 1.43, uncertainLine: { timeSec: 246.7, confidence: 0.94 } })

    expect(sentences(item([other]))).toEqual([
      'The recording has a bar line at 4:06.7 almost as strong (94%) as this one (66%). The bars after this one follow whichever is right.',
    ])
  })

  it('asks whether p1 is a pickup when the readings disagree, and where it starts when the recording does not show it', () => {
    const unsure = flag({ kind: 'pickup', expected: 2, found: 1, factor: null })
    const noOnset = flag({ kind: 'pickup', expected: 2, found: 2, factor: null })

    expect(sentences(item([unsure]))[0]).toMatch(/^Is p1 a pickup\?/)
    expect(sentences(item([noOnset]))[0]).toMatch(/nothing in the recording starts near/)
  })

  it('says the recording skipped the repeat, with the chip and the bars it left out', () => {
    const skipped = flag({ kind: 'skipped-repeat', expected: 78, found: 56, factor: null })

    expect(chipsOf(item([skipped])).map((chip) => chip.label)).toEqual(['Repeat skipped'])
    expect(sentences(item([skipped]))).toEqual([
      'The recording skips the repeat here, so its bars are mapped straight through: 56 bars, not the 78 the score plays with its repeats.',
    ])
  })

  it('says the recording\'s beat is not the score\'s, with the whole numbers, the chip "Wrong beat" and what to do', () => {
    // found 1.03 is heard at 1 beat a bar, the score's mean of 2.9375 is 3: both are shown rounded
    const pulse = flag({ kind: 'pulse', expected: 2.9375, found: 1.03, factor: 0.35 })

    expect(chipsOf(item([pulse])).map((chip) => chip.label)).toEqual(['Wrong beat'])
    expect(sentences(item([pulse]))).toEqual([
      "The recording's beat looks like 1 per bar, not 3. Check the first 3 bars by ear and press Continue, or put the bar lines on every beat now. If the recording takes the repeats, set them in Edit piece structure first.",
    ])
    const two = flag({ kind: 'pulse', expected: 3.4, found: 1.96, factor: 0.58 })
    expect(sentences(item([two]))[0]).toBe(
      "The recording's beat looks like 2 per bar, not 3. Check the first 3 bars by ear and press Continue, or put the bar lines on every 2 beats now. If the recording takes the repeats, set them in Edit piece structure first.",
    )
  })

  it('keeps the old flag kinds as they were', () => {
    expect(chipsOf(item([flag({ kind: 'skipped-repeat', expected: 78, found: 56, factor: null })])).map((chip) => chip.label)).toEqual(['Repeat skipped'])
    expect(chipsOf(item([flag({ kind: 'pickup', expected: 2, found: 1, factor: null })])).map((chip) => chip.label)).toEqual(['Pickup?'])
  })

  it('explains a fermata, and adds the uncertain bar line when there is one', () => {
    expect(sentences(item([flag({ severity: 0, explainedBy: 'fermata', factor: 1.6 })]))).toEqual(['A fermata explains the length.'])
    expect(
      sentences(item([flag({ severity: 0, explainedBy: 'fermata', factor: 1.6, uncertainLine: { timeSec: 89.2, confidence: 0.41 } })])),
    ).toEqual(['A fermata explains the length.', '…but the bar line at 1:29.2 is uncertain (downbeat 41%).'])
  })

  it('explains a rit. the same way, for a flag in either direction', () => {
    expect(sentences(item([flag({ severity: 0, explainedBy: 'rit', factor: 1.3 })]))).toEqual(['A rit. explains the length.'])
    expect(sentences(item([flag({ kind: 'crowded', severity: 0, explainedBy: 'rit', factor: 0.7 })]))).toEqual([
      'Bar 41 is 1.4x shorter than the bars around it.',
      'A rit. explains the length.',
    ])
    expect(
      sentences(item([flag({ severity: 0, explainedBy: 'rit', factor: 1.3, uncertainLine: { timeSec: 89.2, confidence: 0.41 } })])),
    ).toEqual(['A rit. explains the length.', '…but the bar line at 1:29.2 is uncertain (downbeat 41%).'])
  })

  it('says how far a hand-moved item moved, and that an unmatched bar has no time', () => {
    expect(explanationOf(item([], { moved: true }), { partName: 'Clarinet', movedBySec: 0.42, names: barNamesOf(undefined) })).toEqual([text.explain.moved('+0.42')])
    expect(sentences({ kind: 'unmatched', bar: 7, passIndex: 1 })).toEqual([text.explain.unmatched('7 (2)')])
  })
})
