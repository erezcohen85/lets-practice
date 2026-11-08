import { renderHook } from '@testing-library/react'
import { usePulseRegrid } from '@/components/editor/usePulseRegrid'
import { regridRefusalText, regridSentence } from '@/components/waveform/regridEdit'
import { type DetectedBeat } from '@/domain/beats'
import { type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { regridForPulse } from '@/domain/pulseRegrid'
import { type Locator, type ReviewFlag } from '@/domain/types'
import { strings } from '@/strings'

// The Wrong beat card's edit as the page runs it: what it says when it cannot act (the beats are still loading, there are none, no
// card is waiting, the edit was refused) and what it does when it can.

const g = strings.dock.grid
const BAR_COUNT = 8
const DURATION_SEC = 61
/** The recording hears one beat to a bar of the 3/4 score: beats 2 s apart from 1 s, and the lines 1 s apart. */
const beats: DetectedBeat[] = Array.from({ length: 30 }, (_, i) => ({ t: 1 + 2 * i, downbeat: 0.5 }))
const pulse: ReviewFlag = { kind: 'pulse', severity: 1, expected: 3, found: 1.03, factor: 1.03 / 3, explainedBy: null, uncertainLine: null }

function docWith(first: Partial<Locator> = { flags: [pulse] }): EditorDoc {
  const locators: Locator[] = Array.from({ length: BAR_COUNT }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 1 + i, confirmed: false, ...(i === 0 ? first : {}) }))
  return { timing: { barCount: BAR_COUNT, playOrder: [{ from: 1, to: BAR_COUNT }], meters: [{ fromBar: 1, numerator: 3, denominator: 4 }], marks: [], locators }, pages: [] }
}

interface Options {
  doc?: EditorDoc
  beats?: readonly DetectedBeat[] | null
  beatsLoaded?: boolean
  auto?: boolean
  ready?: boolean
  apply?: (result: EditResult) => ReturnType<Parameters<typeof usePulseRegrid>[0]['apply']>
}

function setup(options: Options = {}) {
  const applied: EditResult[] = []
  const said: string[] = []
  const apply = options.apply ?? ((result: EditResult) => (result.ok ? null : result.reason))
  const props = {
    doc: options.doc ?? docWith(),
    beats: options.beats === undefined ? beats : options.beats,
    beatsLoaded: options.beatsLoaded ?? true,
    durationSec: DURATION_SEC,
    apply: (result: EditResult) => {
      applied.push(result)
      return apply(result)
    },
    auto: options.auto ?? false,
    ready: options.ready ?? true,
    notify: (sentence: string) => said.push(sentence),
  }
  const view = renderHook((current: typeof props) => usePulseRegrid(current), { initialProps: props })
  return { ...view, props, applied, said }
}

describe('usePulseRegrid', () => {
  it('applies the edit, says what it did in the toolbar\'s sentence, and gives no reason back', () => {
    const { result, applied, said } = setup()

    expect(result.current.regrid()).toBeNull()

    expect(applied).toHaveLength(1)
    const expected = regridForPulse(docWith(), beats, DURATION_SEC)!
    expect(said).toEqual([regridSentence(expected, null)])
    expect(applied[0].ok && applied[0].label.kind).toBe('regrid')
  })

  it('gives the reason back, and says nothing in the hint line, when the edit was refused', () => {
    const { result, said } = setup({ apply: () => 'no-free-slot' })

    expect(result.current.regrid()).toBe(regridRefusalText('no-free-slot'))
    expect(said).toEqual([])
  })

  it('says its own sentence, not the "none would change" one, when no Wrong beat card is waiting', () => {
    const { result, applied } = setup({ doc: docWith({}) })

    const reason = result.current.regrid()

    expect(reason).toBe(g.noWrongBeat)
    expect(reason).not.toBe(g.refusedNothing)
    expect(g.noWrongBeat).toBe('No Wrong beat card is waiting any more, so nothing changed.')
    expect(applied).toEqual([])
  })

  it('says the recording has no detected beats only once the beats have loaded and there are none', () => {
    const none = setup({ beats: null, beatsLoaded: true })
    expect(none.result.current.regrid()).toBe(g.noBeats)
    expect(none.applied).toEqual([])

    const fewer = setup({ beats: [{ t: 1, downbeat: 0.5 }], beatsLoaded: true })
    expect(fewer.result.current.regrid()).toBe(g.noBeats)
  })

  it('says nothing, and does nothing, while the beats are still loading', () => {
    const { result, applied, said } = setup({ beats: null, beatsLoaded: false })

    expect(result.current.canRegrid).toBe(false)
    expect(result.current.regrid()).toBeNull()
    expect(applied).toEqual([])
    expect(said).toEqual([])
  })

  it('can act once the beats have loaded, with beats or without', () => {
    expect(setup().result.current.canRegrid).toBe(true)
    expect(setup({ beats: null, beatsLoaded: true }).result.current.canRegrid).toBe(true)
  })

  describe('automatically', () => {
    it('does it once when the beats are in and the opening fill is over, and never again', () => {
      const { rerender, props, applied } = setup({ auto: true })
      expect(applied).toHaveLength(1)

      rerender({ ...props, doc: docWith() })
      rerender({ ...props, beats: [...beats] })
      expect(applied).toHaveLength(1)
    })

    it('waits for the beats to load', () => {
      const { rerender, props, applied } = setup({ auto: true, beats: null, beatsLoaded: false })
      expect(applied).toEqual([])

      rerender({ ...props, beats, beatsLoaded: true })
      expect(applied).toHaveLength(1)
    })

    it('waits for the opening fill', () => {
      const { rerender, props, applied } = setup({ auto: true, ready: false })
      expect(applied).toEqual([])

      rerender({ ...props, ready: true })
      expect(applied).toHaveLength(1)
    })

    it('says nothing and changes nothing when the beats loaded and there are none', () => {
      const { applied, said } = setup({ auto: true, beats: null, beatsLoaded: true })

      expect(applied).toEqual([])
      expect(said).toEqual([])
    })

    it('does nothing when it is off', () => {
      expect(setup({ auto: false }).applied).toEqual([])
    })
  })
})
