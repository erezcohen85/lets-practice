import { dockLocators, formatClock, locatorState, windowBars } from '@/components/waveform/dockLayout'
import { type EditorDoc } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { reviewItems } from '@/domain/reviewQueue'
import { type ReviewFlag } from '@/domain/types'

const FLAG: ReviewFlag = { kind: 'crowded', severity: 1, expected: 3.6, found: 1.8, factor: 0.5, explainedBy: null, uncertainLine: null }

function flagged(labels: string[], checked: string[] = []): EditorDoc {
  const doc = demoDoc()
  return {
    ...doc,
    timing: {
      ...doc.timing,
      locators: doc.timing.locators.map((l) => {
        const label = `${l.bar}:${l.passIndex}`
        return labels.includes(label) ? { ...l, flags: [FLAG], ...(checked.includes(label) ? { checked: true } : {}) } : l
      }),
    },
  }
}

describe('dockLocators', () => {
  it('lists one locator per play slot that has one, in play order, with its pass', () => {
    const doc = demoDoc()

    const locators = dockLocators(doc.timing, [], [])

    expect(locators).toHaveLength(72)
    expect(locators[0]).toMatchObject({ bar: 1, passIndex: 0, timeSec: 1 })
    expect(locators[16]).toMatchObject({ bar: 9, passIndex: 1, timeSec: 58.6 })
  })

  it('leaves out a slot without a locator', () => {
    const doc = demoDoc()
    const timing = { ...doc.timing, locators: doc.timing.locators.filter((l) => l.bar !== 5) }

    expect(dockLocators(timing, [], [])).toHaveLength(71)
  })

  it('marks the open items: flagged and not checked, or moved and not checked', () => {
    const doc = flagged(['6:0', '14:0'], ['14:0'])
    const items = reviewItems(doc, 'clarinet')

    const open = dockLocators(doc.timing, items, []).filter((l) => l.open).map((l) => l.bar)

    expect(open).toEqual([6])
  })

  it('carries moved and confirmed', () => {
    const doc = demoDoc()

    const [first, second] = dockLocators(doc.timing, [], [{ bar: 2, passIndex: 0, fromSec: 4, wasConfirmed: false }])

    expect(first).toMatchObject({ confirmed: true, moved: false })
    expect(second).toMatchObject({ confirmed: false, moved: true })
  })

  it('carries filled for the slots it is told were filled in', () => {
    const doc = demoDoc()

    const [first, second] = dockLocators(doc.timing, [], [], [{ bar: 2, passIndex: 0 }])

    expect(first.filled).toBe(false)
    expect(second.filled).toBe(true)
  })
})

describe('locatorState', () => {
  const base = { bar: 3, passIndex: 0, timeSec: 8, confirmed: false, open: false, moved: false, filled: false }

  it('is plain for a locator nothing is said about', () => {
    expect(locatorState(base, null)).toBe('plain')
  })

  it('is anchor for a confirmed one and problem for an open flagged one', () => {
    expect(locatorState({ ...base, confirmed: true }, null)).toBe('anchor')
    expect(locatorState({ ...base, open: true }, null)).toBe('problem')
  })

  it('keeps a hand-moved locator an anchor even while its item is open', () => {
    expect(locatorState({ ...base, open: true, moved: true, confirmed: true }, null)).toBe('anchor')
  })

  it('is filled for a locator the app filled in and nobody has confirmed, and anchor once it is confirmed', () => {
    expect(locatorState({ ...base, filled: true }, null)).toBe('filled')
    expect(locatorState({ ...base, filled: true, confirmed: true }, null)).toBe('anchor')
    expect(locatorState({ ...base, filled: true }, { bar: 3, passIndex: 0 })).toBe('selected')
  })

  it('is selected whatever else it is', () => {
    expect(locatorState({ ...base, confirmed: true, open: true }, { bar: 3, passIndex: 0 })).toBe('selected')
    expect(locatorState(base, { bar: 3, passIndex: 1 })).toBe('plain')
  })
})

describe('windowBars', () => {
  it('draws one bar per column, each the loudest peak of its time', () => {
    // 10 peaks over 10 s: the one of second 4 is loud.
    const peaks = [0.1, 0.1, 0.1, 0.1, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1]

    const bars = windowBars(peaks, 10, { startSec: 0, spanSec: 10 }, 100, 10)

    expect(bars).toHaveLength(10)
    expect(bars.map((bar) => bar.amplitude)).toEqual(peaks)
    expect(bars[4].x).toBe(40)
  })

  it('takes the loudest of the peaks that share a column', () => {
    const bars = windowBars([0.2, 0.8, 0.3, 0.1], 4, { startSec: 0, spanSec: 4 }, 20, 10)

    expect(bars.map((bar) => bar.amplitude)).toEqual([0.8, 0.3])
  })

  it('draws only the window, and nothing outside the recording', () => {
    const peaks = Array.from({ length: 100 }, (_, i) => (i + 1) / 100)

    const inside = windowBars(peaks, 100, { startSec: 50, spanSec: 10 }, 100, 10)
    const past = windowBars(peaks, 100, { startSec: 95, spanSec: 10 }, 100, 10)

    expect(inside).toHaveLength(10)
    expect(inside[0].amplitude).toBeCloseTo(0.51, 9)
    expect(past).toHaveLength(5)
  })

  it('gives nothing for no peaks', () => {
    expect(windowBars([], 10, { startSec: 0, spanSec: 10 }, 100, 10)).toEqual([])
  })
})
describe('formatClock', () => {
  it('writes m:ss.s', () => {
    expect(formatClock(0)).toBe('0:00.0')
    expect(formatClock(102.34)).toBe('1:42.3')
    expect(formatClock(271)).toBe('4:31.0')
    expect(formatClock(3600)).toBe('60:00.0')
  })

  it('cuts the tenths off instead of rounding, so a minute never reads 0:60.0', () => {
    expect(formatClock(59.96)).toBe('0:59.9')
    expect(formatClock(4.6)).toBe('0:04.6')
  })

  it('reads a negative time as 0', () => {
    expect(formatClock(-3)).toBe('0:00.0')
  })
})
