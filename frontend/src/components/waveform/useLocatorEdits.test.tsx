import { act, renderHook } from '@testing-library/react'
import { useLocatorEdits } from '@/components/waveform/useLocatorEdits'
import { type DockEdit } from '@/components/waveform/WaveformDock'
import { type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { type ClickMode } from '@/domain/types'
import { strings } from '@/strings'

// UX part 10: Delete and Add on the waveform follow the "Renumber the bars after" switch; Shift does the other one.

const doc = demoDoc()
const slot = { bar: 5, passIndex: 0 }
const time = doc.timing.locators.find((l) => l.bar === 5)!.timeSec + 1

function run(barLineMode: ClickMode, edit: DockEdit): EditResult {
  let applied: EditResult | undefined
  const { result } = renderHook(() =>
    useLocatorEdits(
      doc,
      (result) => {
        applied = result
        return null
      },
      barLineMode,
    ),
  )
  result.current.onEdit(edit)
  if (applied === undefined) throw new Error('nothing was applied')
  return applied
}

/** The bar the locator at `time` sits on after the edit, or 'refused' when the edit was. */
const barOf = (result: EditResult, time: number) => (result.ok ? result.doc.timing.locators.find((l) => l.timeSec === time)?.bar : 'refused')
const laterTime = doc.timing.locators.find((l) => l.bar === 6)!.timeSec

describe.each([
  ['delete', { kind: 'delete', slot } as const],
  ['add', { kind: 'add', timeSec: time } as const],
])('%s on the waveform', (name, base) => {
  // A ripple moves the later bar 6 by one (back for delete, forward for add). A plain delete leaves it on bar 6; a plain add
  // at a spot with no free bar is refused.
  const rippled = name === 'delete' ? 5 : 7
  const plain = name === 'delete' ? 6 : 'refused'
  it.each([
    ['ripple', false, rippled],
    ['plain', false, plain],
    ['ripple', true, plain],
    ['plain', true, rippled],
  ] as const)('with the switch %s and Shift %s the later bar ends as %s', (barLineMode, shift, expected) => {
    expect(barOf(run(barLineMode, { ...base, shift }), laterTime)).toBe(expected)
  })
})

// Bar lines on the beats: the dock sends one 'regrid' edit; the hook applies regridLocators as one step and says what it did.
describe('a regrid on the waveform', () => {
  // A beat every 0.5 s from 1 s; bars 1 to 4 sit on every 4th beat (1, 3, 5, 7 s), the aligner's guesses.
  const BEAT_SEC = 0.5
  const beats = Array.from({ length: 40 }, (_, i) => ({ t: 1 + BEAT_SEC * i, downbeat: i % 4 === 0 ? 0.9 : 0.1 }))
  const pulseDoc = (barCount: number, checked: readonly number[] = []): EditorDoc => ({
    timing: {
      barCount,
      playOrder: [{ from: 1, to: barCount }],
      meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
      marks: [],
      locators: [1, 2, 3, 4].map((bar) => ({ bar, passIndex: 0, timeSec: 1 + 2 * (bar - 1), confirmed: checked.includes(bar) })),
    },
    pages: [],
  })
  const everyTwoBeats = (extra: Partial<Extract<DockEdit, { kind: 'regrid' }>> = {}): DockEdit => ({
    kind: 'regrid',
    stretch: { fromSec: 1, toSec: 7, fit: 'ripple' },
    beats,
    beatsPerBar: 2,
    offsetSec: 0,
    continuedFrom: null,
    ...extra,
  })

  function runRegrid(regridDoc: EditorDoc, edit: DockEdit) {
    let applied: EditResult | undefined
    const { result } = renderHook(() =>
      useLocatorEdits(
        regridDoc,
        (next) => {
          applied = next
          return next.ok ? null : next.reason
        },
        'ripple',
      ),
    )
    let reason: ReturnType<typeof result.current.onEdit> = null
    act(() => {
      reason = result.current.onEdit(edit)
    })
    return { applied, reason, hint: result.current.refusal }
  }

  it('is applied as one step that puts the bar lines on the beats, and says how many it placed', () => {
    const { applied, reason, hint } = runRegrid(pulseDoc(10), everyTwoBeats())

    expect(reason).toBeNull()
    expect(applied?.ok && applied.label).toEqual({ kind: 'regrid' })
    expect(applied?.ok && applied.doc.timing.locators.map((l) => l.timeSec)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(hint).toBe(strings.dock.grid.done(3, 0, 0))
    expect(hint).toBe('3 bar lines placed on the beats.')
  })

  it('counts the beats a bar in the meter the edit names, when it is not the meter of the bar it starts at', () => {
    // 4/4 for bars 1 to 3 and 2/4 from bar 4: Continue learned 4 beats a bar in 4/4, so a 2/4 bar is 2 beats (1 s), not 4 (2 s)
    const meters = [{ fromBar: 1, numerator: 4, denominator: 4 }, { fromBar: 4, numerator: 2, denominator: 4 }]
    const base = pulseDoc(10, [1, 2, 3, 4])
    const continueDoc: EditorDoc = {
      ...base,
      timing: {
        ...base.timing,
        meters,
        locators: [...base.timing.locators, ...[5, 6, 7, 8].map((bar) => ({ bar, passIndex: 0, timeSec: 7.3 + 0.7 * (bar - 4), confirmed: false }))],
      },
    }
    const edit = (extra: Partial<Extract<DockEdit, { kind: 'regrid' }>>): DockEdit =>
      everyTwoBeats({ stretch: { fromSec: 7, toSec: 40, fit: 'between' }, beatsPerBar: 4, ...extra })

    const named = runRegrid(continueDoc, edit({ referenceMeter: { numerator: 4, denominator: 4 } }))
    expect(named.applied?.ok && named.applied.doc.timing.locators.map((l) => l.timeSec)).toEqual([1, 3, 5, 7, 8, 9, 10, 11, 12, 13])

    const unnamed = runRegrid(continueDoc, edit({}))
    expect(unnamed.applied?.ok && unnamed.applied.doc.timing.locators.slice(3, 6).map((l) => l.timeSec)).toEqual([7, 9, 11])
  })

  it('says how many lines it spread evenly when the beats stop short of the next checked bar line', () => {
    // Bars 1 to 4 are checked (4 beats a bar), bar 9 is checked at 12.2 s: bars 5 to 8 lie between, and the beats give only 5 and 6 (9 s, 11 s)
    const base = pulseDoc(10, [1, 2, 3, 4])
    const gapDoc: EditorDoc = {
      ...base,
      timing: {
        ...base.timing,
        locators: [
          ...base.timing.locators,
          ...[5, 6, 7, 8].map((bar) => ({ bar, passIndex: 0, timeSec: 7.4 + (bar - 4), confirmed: false })),
          { bar: 9, passIndex: 0, timeSec: 12.2, confirmed: true },
        ],
      },
    }
    const { applied, hint } = runRegrid(gapDoc, everyTwoBeats({ stretch: { fromSec: 7, toSec: 12.2, fit: 'between' }, beatsPerBar: 4, referenceMeter: { numerator: 4, denominator: 4 } }))

    // 9 s and 11 s are on beats; the other two are a third and two thirds of the way from 11 s to the checked line at 12.2 s
    expect(applied?.ok && applied.doc.timing.locators.map((l) => Math.round(l.timeSec * 10) / 10)).toEqual([1, 3, 5, 7, 9, 11, 11.4, 11.8, 12.2])
    expect(hint).toBe(strings.dock.grid.done(4, 0, 0, 2))
    expect(hint).toBe('4 bar lines placed on the beats. 2 spread evenly before the next checked bar line.')
  })

  it('says how many later bar lines it pushed off the last bar, by count only', () => {
    const { hint } = runRegrid(pulseDoc(6), everyTwoBeats())

    expect(hint).toBe('3 bar lines placed on the beats. 1 later bar line dropped past the last bar.')
  })

  it('says which bars Continue learned from, by the names the screen gives them', () => {
    const { hint } = runRegrid(pulseDoc(10), everyTwoBeats({ continuedFrom: { first: '1', last: 'p4' } }))

    expect(hint).toBe('Continued from your bars 1 to p4: 3 bar lines placed on the beats.')
  })

  it('says why when there was nothing to change, and returns the reason', () => {
    const { reason, hint } = runRegrid(pulseDoc(10), everyTwoBeats({ beatsPerBar: 4 }))

    expect(reason).toBe('out-of-range')
    expect(hint).toBe(strings.dock.grid.refusedNothing)
  })

  it('says why when a checked bar line is in the way of the ripple', () => {
    // bar 4 is checked, and the last bar: the adds would push it off
    const { reason, hint } = runRegrid(pulseDoc(4, [4]), everyTwoBeats())

    expect(reason).toBe('no-free-slot')
    expect(hint).toBe(strings.dock.grid.refusedNoRoom)
  })
})
