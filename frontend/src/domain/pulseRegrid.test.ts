import { describe, expect, it } from 'vitest'
import { type DetectedBeat } from './beats'
import { type EditorDoc } from './pieceEdits'
import { isPendingPulse, pendingPulse, pulseBeatsPerBar, referenceMeterOf, regridForPulse } from './pulseRegrid'
import { type Locator, type Meter, type PlayOrderRow, type ReviewFlag } from './types'

// A synthetic 3/4 piece of 8 bars. The processor heard one beat to a bar (found 1.03, the score says 3), so the recording's
// beats are 2 s apart from 1 s, and the aligner's lines are 1 s apart: every other one is on a beat.
const BAR_COUNT = 8
const DURATION_SEC = 61
const beats: DetectedBeat[] = Array.from({ length: 30 }, (_, i) => ({ t: 1 + 2 * i, downbeat: 0.5 }))

const M34: Meter = { numerator: 3, denominator: 4 }
const M44: Meter = { numerator: 4, denominator: 4 }
/** The processor's flag: factor is found / expected unless a test gives one. */
const pulse = (rest: Partial<ReviewFlag> = {}): ReviewFlag => {
  const flag: ReviewFlag = { kind: 'pulse', severity: 1, expected: 2.9375, found: 1.03, factor: null, explainedBy: null, uncertainLine: null, ...rest }
  return { ...flag, factor: rest.factor === undefined ? flag.found / flag.expected : rest.factor }
}
const other = (kind: ReviewFlag['kind'] = 'crowded'): ReviewFlag => ({ kind, severity: 1, expected: 2, found: 1, factor: 0.5, explainedBy: null, uncertainLine: null })

/** Bars 1 to 8 with a line each, 1 s apart from 1 s; `first` replaces the first line's fields. */
function docWith(
  first: Partial<Locator> = {},
  playOrder: PlayOrderRow[] = [{ from: 1, to: BAR_COUNT }],
  extra: Locator[] = [],
  meters: EditorDoc['timing']['meters'] = [{ fromBar: 1, numerator: 3, denominator: 4 }],
): EditorDoc {
  const locators: Locator[] = Array.from({ length: BAR_COUNT }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 1 + i, confirmed: false }))
  locators[0] = { ...locators[0], ...first }
  return { timing: { barCount: BAR_COUNT, playOrder, meters, marks: [], locators: [...locators, ...extra] }, pages: [] }
}

/** The same doc with `change` applied to the locator of `bar`. */
const withLocator = (doc: EditorDoc, bar: number, change: Partial<Locator>): EditorDoc => ({
  ...doc,
  timing: { ...doc.timing, locators: doc.timing.locators.map((l) => (l.bar === bar ? { ...l, ...change } : l)) },
})

/** A pickup bar 0 before bar 1: the pulse flag sits on bar 1, the second slot. The lines are on the beats of the recording (2 s apart from 1 s) from the pickup on. */
function docWithPickup(flagged: readonly number[] = [1]): EditorDoc {
  const pickup: Locator = { bar: 0, passIndex: 0, timeSec: 1, confirmed: false }
  const bars: Locator[] = Array.from({ length: BAR_COUNT }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 3 + i, confirmed: false, ...(flagged.includes(i + 1) ? { flags: [pulse()] } : {}) }))
  return { timing: { barCount: BAR_COUNT, playOrder: [{ from: 0, to: BAR_COUNT }], meters: [{ fromBar: 1, numerator: 3, denominator: 4 }], marks: [], locators: [pickup, ...bars] }, pages: [] }
}

describe('pulseBeatsPerBar', () => {
  it('is the beats a bar of the reference meter the recording was heard at: factor x the meter\'s felt beats, rounded', () => {
    // 3/4 heard at 1 a bar: factor 0.35 x 3 = 1.05
    expect(pulseBeatsPerBar(pulse({ found: 1.03 }), M34)).toBe(1)
    // 4/4 heard at 2 a bar
    expect(pulseBeatsPerBar(pulse({ found: 1.96, expected: 4 }), M44)).toBe(2)
    expect(pulseBeatsPerBar(pulse({ found: 6, expected: 6 }), { numerator: 6, denominator: 4 })).toBe(6)
  })

  it('is the flag\'s own number for a piece of one meter, whatever the meter (found / expected x felt beats = found)', () => {
    for (const [meter, found] of [[M34, 1.03], [M44, 2.03], [{ numerator: 2, denominator: 4 }, 1], [{ numerator: 6, denominator: 8 }, 1]] as const) {
      const score = meter.denominator === 8 ? meter.numerator / 3 : meter.numerator
      expect(pulseBeatsPerBar(pulse({ found, expected: score }), meter)).toBe(Math.round(found))
    }
  })

  it('counts compound meters as they are felt: 6/8 is 2 beats', () => {
    // 6/8 heard at 1 a bar: the factor is 0.5
    expect(pulseBeatsPerBar(pulse({ found: 1, expected: 2 }), { numerator: 6, denominator: 8 })).toBe(1)
  })

  it('is null for a number the controls do not have', () => {
    expect(pulseBeatsPerBar(pulse({ found: 0.2, expected: 3 }), M34)).toBeNull()
    expect(pulseBeatsPerBar(pulse({ found: 7.1, expected: 3 }), M34)).toBeNull()
  })

  it('works from found and expected when the flag has no factor', () => {
    expect(pulseBeatsPerBar({ ...pulse({ found: 2.03, expected: 4 }), factor: null }, M44)).toBe(2)
    expect(pulseBeatsPerBar({ ...pulse({ found: 2.03, expected: 0 }), factor: null }, M44)).toBeNull()
  })

  it('counts in the meter of most of the bars, not in the average of the whole piece: 5 bars of 2/4 and 3 of 6/4 heard at 1 a 2/4 bar', () => {
    // the processor shares 14 beats among 8 slots: found 1.75 against a mean of 3.5 felt beats; the first count (round(found)) said 2
    expect(pulseBeatsPerBar(pulse({ found: 1.75, expected: 3.5 }), { numerator: 2, denominator: 4 })).toBe(1)
  })
})

describe('referenceMeterOf', () => {
  it('is the meter the most slots of the play order have', () => {
    const meters = [{ fromBar: 1, numerator: 3, denominator: 4 }, { fromBar: 3, numerator: 4, denominator: 4 }]
    expect(referenceMeterOf(docWith({}, undefined, [], meters).timing)).toEqual(M44)
    expect(referenceMeterOf(docWith().timing)).toEqual(M34)
  })

  it('counts the slots as played, so a repeated stretch counts twice', () => {
    // bars 1 to 2 in 3/4, bars 3 to 8 in 4/4, but bars 1 to 2 are played 4 more times
    const meters = [{ fromBar: 1, numerator: 3, denominator: 4 }, { fromBar: 3, numerator: 4, denominator: 4 }]
    const playOrder: PlayOrderRow[] = [{ from: 1, to: 8 }, { from: 1, to: 2 }, { from: 1, to: 2 }, { from: 1, to: 2 }]
    expect(referenceMeterOf(docWith({}, playOrder, [], meters).timing)).toEqual(M34)
  })

  it('takes the meter that comes first when two have as many slots', () => {
    const meters = [{ fromBar: 1, numerator: 3, denominator: 4 }, { fromBar: 5, numerator: 4, denominator: 4 }]
    expect(referenceMeterOf(docWith({}, undefined, [], meters).timing)).toEqual(M34)
  })
})

describe('isPendingPulse', () => {
  it('is true for a locator with a pulse flag that the score does not explain, that is not checked', () => {
    expect(isPendingPulse({ flags: [other(), pulse()] })).toBe(true)
  })

  it('is false once the locator is checked, for a flag the score explains (severity 0), for another kind of flag, and for none', () => {
    expect(isPendingPulse({ flags: [pulse()], checked: true })).toBe(false)
    expect(isPendingPulse({ flags: [pulse({ severity: 0 })] })).toBe(false)
    expect(isPendingPulse({ flags: [other()] })).toBe(false)
    expect(isPendingPulse({ flags: [] })).toBe(false)
    expect(isPendingPulse({})).toBe(false)
  })

  it('reads a review item the same way: a flag item has flags and checked', () => {
    expect(isPendingPulse({ flags: [pulse()], checked: false })).toBe(true)
    expect(isPendingPulse({ flags: [pulse()], checked: true })).toBe(false)
  })
})

describe('pendingPulse', () => {
  it('finds the pulse flag on the first slot', () => {
    const found = pendingPulse(docWith({ flags: [other(), pulse()] }).timing)
    expect(found?.locator.bar).toBe(1)
    expect(found?.flag.kind).toBe('pulse')
    expect(found?.beatsPerBar).toBe(1)
    expect(found?.reference).toEqual(M34)
  })

  it('finds it on the pickup bar when the piece has one: the first slot is bar 0', () => {
    const pickup: Locator = { bar: 0, passIndex: 0, timeSec: 0.5, confirmed: false, flags: [pulse()] }
    const doc = docWith({}, [{ from: 0, to: BAR_COUNT }], [pickup])
    const timing = { ...doc.timing, locators: [pickup, ...doc.timing.locators.filter((l) => l.bar !== 0)] }
    expect(pendingPulse(timing)?.locator.bar).toBe(0)
  })

  it('finds it wherever it is: the flag left the first slot when a pickup was added', () => {
    const found = pendingPulse(docWithPickup().timing)
    expect(found?.locator).toMatchObject({ bar: 1, passIndex: 0 })
    expect(found?.beatsPerBar).toBe(1)
  })

  it('finds the first flagged locator in slot order when several hold one', () => {
    const doc = withLocator(withLocator(docWith(), 5, { flags: [pulse()] }), 3, { flags: [pulse({ found: 1.97, expected: 4 })] })
    expect(pendingPulse(doc.timing)?.locator.bar).toBe(3)
  })

  it('skips a resolved flag and goes on to a pending one after it', () => {
    const doc = withLocator(docWith({ flags: [pulse()], checked: true }), 4, { flags: [pulse()] })
    expect(pendingPulse(doc.timing)?.locator.bar).toBe(4)
  })

  it('is null when no locator holds a pulse flag, or the flag is for another kind', () => {
    expect(pendingPulse(docWith({ flags: [other()] }).timing)).toBeNull()
    expect(pendingPulse(docWith().timing)).toBeNull()
  })

  it('is null once the card is resolved (checked), and for a flag explained by the score (severity 0)', () => {
    expect(pendingPulse(docWith({ flags: [pulse()], checked: true }).timing)).toBeNull()
    expect(pendingPulse(docWith({ flags: [pulse({ severity: 0 })] }).timing)).toBeNull()
  })

  it('is null for a map with no locators, or none that holds the flag', () => {
    const doc = docWith({ flags: [pulse()] })
    expect(pendingPulse({ ...doc.timing, locators: doc.timing.locators.slice(1) })).toBeNull()
    expect(pendingPulse({ ...doc.timing, barCount: 0, playOrder: [], locators: [] })).toBeNull()
  })

  it('keeps the number null when the flag asks for a pulse the controls do not have', () => {
    const found = pendingPulse(docWith({ flags: [pulse({ found: 8, expected: 3 })] }).timing)
    expect(found).not.toBeNull()
    expect(found?.beatsPerBar).toBeNull()
  })

  it('counts the beats in the meter most bars have, not the first bar\'s: a 3/4 intro and then 4/4', () => {
    // 2 bars of 3/4, then 6 of 4/4 (mean 3.75), heard at 2 a 4/4 bar: found (2 x 1.5 + 6 x 2) / 8 = 1.875
    const meters = [{ fromBar: 1, numerator: 3, denominator: 4 }, { fromBar: 3, numerator: 4, denominator: 4 }]
    const found = pendingPulse(docWith({ flags: [pulse({ found: 1.875, expected: 3.75 })] }, undefined, [], meters).timing)
    expect(found?.reference).toEqual(M44)
    expect(found?.beatsPerBar).toBe(2)
  })
})

describe('regridForPulse', () => {
  it('puts the bar lines of the whole piece on every N-th beat, N being the beats the recording was heard at', () => {
    const doc = docWith({ flags: [pulse()] })
    const outcome = regridForPulse(doc, beats, DURATION_SEC)!
    expect(outcome.result.ok).toBe(true)
    if (!outcome.result.ok) return
    expect(outcome.result.label.kind).toBe('regrid')
    // 1 beat a bar: a line on every beat, 2 s apart, from the first line
    expect(outcome.result.doc.timing.locators.map((l) => l.timeSec)).toEqual([1, 3, 5, 7, 9, 11, 13, 15])
    expect(outcome.placed).toBeGreaterThan(0)
  })

  it('uses 3 beats a bar for a pulse of 3', () => {
    // 6/4 heard at 3 a bar
    const doc = docWith({ flags: [pulse({ found: 2.97, expected: 6 })] }, undefined, [], [{ fromBar: 1, numerator: 6, denominator: 4 }])
    const outcome = regridForPulse(doc, beats, DURATION_SEC)!
    expect(outcome.result.ok).toBe(true)
    if (!outcome.result.ok) return
    expect(outcome.result.doc.timing.locators.map((l) => l.timeSec)).toEqual([1, 7, 13, 19, 25, 31, 37, 43])
  })

  it('resolves the card in the same step: the first line is checked, its flags stay, and it is not made a fixed anchor', () => {
    const doc = docWith({ flags: [pulse(), other()] })
    const outcome = regridForPulse(doc, beats, DURATION_SEC)!
    if (!outcome.result.ok) throw new Error('refused')
    const first = outcome.result.doc.timing.locators[0]
    expect(first).toMatchObject({ bar: 1, passIndex: 0, timeSec: 1, checked: true, confirmed: false })
    expect(first.flags?.map((f) => f.kind)).toEqual(['pulse', 'crowded'])
    expect(pendingPulse(outcome.result.doc.timing)).toBeNull()
  })

  it('puts the lines on the beats when the flag left the first slot: a pickup was added, and the card closes', () => {
    const doc = docWithPickup()
    const outcome = regridForPulse(doc, beats, DURATION_SEC)!
    expect(outcome).not.toBeNull()
    expect(outcome.result.ok).toBe(true)
    if (!outcome.result.ok) return
    const lines = outcome.result.doc.timing.locators
    // from the first line (the pickup at 1 s) on every beat, 2 s apart; the flag's line (bar 1 at 3 s) was on one
    expect(lines.slice(0, 5).map((l) => [l.bar, l.timeSec])).toEqual([[0, 1], [1, 3], [2, 5], [3, 7], [4, 9]])
    expect(lines[1]).toMatchObject({ bar: 1, checked: true, confirmed: false })
    expect(lines[1].flags?.map((f) => f.kind)).toEqual(['pulse'])
    // the pickup never held the flag, and is not checked
    expect(lines[0].checked).not.toBe(true)
    expect(pendingPulse(outcome.result.doc.timing)).toBeNull()
  })

  it('checks every line that still holds a pending pulse flag after the edit, found by the flag and not by the bar', () => {
    // bars 1 and 3 are flagged (at 3 s and 5 s, after the pickup at 1 s): the regrid keeps the lines that are on its beats, wherever the ripple numbers them
    const doc = docWithPickup([1, 3])
    const outcome = regridForPulse(doc, beats, DURATION_SEC)!
    if (!outcome.result.ok) throw new Error('refused')
    const flagged = outcome.result.doc.timing.locators.filter((l) => l.flags?.some((f) => f.kind === 'pulse'))
    expect(flagged.length).toBeGreaterThan(0)
    expect(flagged.every((l) => l.checked === true)).toBe(true)
    expect(pendingPulse(outcome.result.doc.timing)).toBeNull()
  })

  it('does not check a line without a pulse flag, nor one that was checked already', () => {
    const doc = withLocator(docWith({ flags: [pulse()] }), 3, { flags: [other()] })
    const outcome = regridForPulse(doc, beats, DURATION_SEC)!
    if (!outcome.result.ok) throw new Error('refused')
    const checkedLines = outcome.result.doc.timing.locators.filter((l) => l.checked === true)
    expect(checkedLines).toHaveLength(1)
    expect(checkedLines[0]).toMatchObject({ bar: 1 })
  })

  it('counts the beats in the meter most bars have: a 3/4 intro of two bars, then 4/4, heard at 2 beats a 4/4 bar', () => {
    const meters = [{ fromBar: 1, numerator: 3, denominator: 4 }, { fromBar: 3, numerator: 4, denominator: 4 }]
    const doc = docWith({ flags: [pulse({ found: 1.875, expected: 3.75 })] }, undefined, [], meters)
    const outcome = regridForPulse(doc, beats, DURATION_SEC)!
    if (!outcome.result.ok) throw new Error('refused')
    // the beats are 2 s apart: a 4/4 bar is 2 of them (4 s), a 3/4 bar 1.5 of them (3 s); counted in 3/4 they would be 2 (4 s) and 2.67
    expect(outcome.result.doc.timing.locators.map((l) => l.timeSec)).toEqual([1, 4, 7, 11, 15, 19, 23, 27])
  })

  it('leaves a checked line of the piece where it is', () => {
    const doc = docWith({ flags: [pulse()] }, undefined, [])
    const checked = { ...doc, timing: { ...doc.timing, locators: doc.timing.locators.map((l) => (l.bar === 3 ? { ...l, confirmed: true } : l)) } }
    const outcome = regridForPulse(checked, beats, DURATION_SEC)!
    if (!outcome.result.ok) throw new Error('refused')
    expect(outcome.result.doc.timing.locators.find((l) => l.confirmed)?.timeSec).toBe(3)
  })

  it('is null when no pulse flag is waiting (nothing to resolve)', () => {
    expect(regridForPulse(docWith(), beats, DURATION_SEC)).toBeNull()
    expect(regridForPulse(docWith({ flags: [pulse()], checked: true }), beats, DURATION_SEC)).toBeNull()
  })

  it('is refused when the flag asks for a pulse the controls do not have', () => {
    const outcome = regridForPulse(docWith({ flags: [pulse({ found: 8, expected: 3 })] }), beats, DURATION_SEC)!
    expect(outcome.result.ok).toBe(false)
  })

  it('is refused, and changes nothing, when the lines are on those beats already', () => {
    const lines: Locator[] = Array.from({ length: BAR_COUNT }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 1 + 2 * i, confirmed: false, ...(i === 0 ? { flags: [pulse()] } : {}) }))
    const doc: EditorDoc = { timing: { ...docWith().timing, locators: lines }, pages: [] }
    const outcome = regridForPulse(doc, beats, DURATION_SEC)!
    expect(outcome.result.ok).toBe(false)
    if (!outcome.result.ok) expect(outcome.result.reason).toBe('out-of-range')
  })
})
