import { type BarNumber, type FlagKind, type ReviewFlag, type TimingLayer } from '@/domain/types'

// The review flags the fakes put on a map: what the processor's flagging would have stored on the locators. The board's
// twelve items sit on the demo piece; a few other pieces get a plain spread so the Library keeps its states.

/** One flagged locator to seed: its slot, the flag, and whether the user has already checked it. */
export interface SeedReviewItem {
  bar: BarNumber
  passIndex: number
  kind: FlagKind
  severity: ReviewFlag['severity']
  expected: number
  found: number
  factor: number | null
  explainedBy?: 'fermata' | 'rit'
  /** Weak downbeat: how sure the detector was of the bar line, which then sits at the locator's time. */
  confidence?: number
  checked: boolean
}

// Lengths are seconds, except for a beat count (beats). The demo piece runs 4.1 s to a 4/4 bar and 2.05 s to a 2/4 bar.
const item = (bar: number, rest: Omit<SeedReviewItem, 'bar' | 'passIndex'>): SeedReviewItem => ({ bar, passIndex: 0, ...rest })

/** The board's twelve review items of the demo piece (design/midnight Editor): seven checked, five still open. */
export const DEMO_REVIEW_ITEMS: SeedReviewItem[] = [
  item(6, { kind: 'crowded', severity: 1, expected: 4.1, found: 2.3, factor: 0.56, checked: true }),
  item(14, { kind: 'beat-count', severity: 2, expected: 4, found: 3, factor: null, checked: true }),
  item(22, { kind: 'weak-downbeat', severity: 1, expected: 4.1, found: 4.1, factor: null, confidence: 0.31, checked: true }),
  item(28, { kind: 'stretched', severity: 0, expected: 4.1, found: 6.56, factor: 1.6, explainedBy: 'fermata', checked: true }),
  item(31, { kind: 'crowded', severity: 2, expected: 4.1, found: 1.7, factor: 0.41, checked: true }),
  item(35, { kind: 'beat-count', severity: 1, expected: 4, found: 5, factor: null, checked: true }),
  item(37, { kind: 'weak-downbeat', severity: 1, expected: 4.1, found: 4.1, factor: null, confidence: 0.38, checked: true }),
  item(41, { kind: 'stretched', severity: 1, expected: 4.1, found: 5.74, factor: 1.4, checked: false }),
  item(43, { kind: 'crowded', severity: 1, expected: 4.1, found: 2.5, factor: 0.61, checked: false }),
  item(45, { kind: 'beat-count', severity: 2, expected: 4, found: 3, factor: null, checked: false }),
  item(52, { kind: 'weak-downbeat', severity: 2, expected: 2.05, found: 2.05, factor: null, confidence: 0.22, checked: false }),
  item(60, { kind: 'stretched', severity: 1, expected: 2.05, found: 3.08, factor: 1.5, checked: false }),
]

/** The same items, none of them checked: what a fresh processing run leaves. */
export function uncheckedItems(items: SeedReviewItem[]): SeedReviewItem[] {
  return items.map((existing) => ({ ...existing, checked: false }))
}

const SPREAD_KINDS: FlagKind[] = ['crowded', 'stretched', 'beat-count', 'weak-downbeat']

/** `count` flagged bars from bar 2 on, cycling through the four kinds, the first `checked` of them checked. */
export function spreadReviewItems(count: number, checked: number): SeedReviewItem[] {
  return Array.from({ length: count }, (_, i): SeedReviewItem => {
    const kind = SPREAD_KINDS[i % SPREAD_KINDS.length]
    return {
      bar: i + 2,
      passIndex: 0,
      kind,
      severity: 1,
      expected: kind === 'beat-count' ? 4 : 2,
      found: kind === 'beat-count' ? 3 : kind === 'crowded' ? 1.2 : kind === 'stretched' ? 2.8 : 2,
      factor: kind === 'crowded' ? 0.6 : kind === 'stretched' ? 1.4 : null,
      ...(kind === 'weak-downbeat' ? { confidence: 0.3 } : {}),
      checked: i < checked,
    }
  })
}

function flagOf(seed: SeedReviewItem, timeSec: number): ReviewFlag {
  return {
    kind: seed.kind,
    severity: seed.severity,
    expected: seed.expected,
    found: seed.found,
    factor: seed.factor,
    explainedBy: seed.explainedBy ?? null,
    uncertainLine: seed.confidence === undefined ? null : { timeSec, confidence: seed.confidence },
  }
}

/** A copy of the timing with the items' flags (and checked) on the locators of their slots; an item without a locator is left out. */
export function applyReviewItems(timing: TimingLayer, items: SeedReviewItem[]): TimingLayer {
  return {
    ...timing,
    locators: timing.locators.map((locator) => {
      const seed = items.find((candidate) => candidate.bar === locator.bar && candidate.passIndex === locator.passIndex)
      if (seed === undefined) return { ...locator }
      return { ...locator, flags: [flagOf(seed, locator.timeSec)], ...(seed.checked ? { checked: true } : {}) }
    }),
  }
}
