import { act, renderHook } from '@testing-library/react'
import { barNamesOf } from '@/domain/barNames'
import { done, type EditorDoc } from '@/domain/pieceEdits'
import { strings } from '@/strings'
import { useShiftNote } from './useShiftNote'

const doc = (): EditorDoc => ({
  timing: { barCount: 4, playOrder: [{ from: 1, to: 4 }], meters: [{ fromBar: 1, numerator: 4, denominator: 4 }], marks: [], locators: [{ bar: 1, passIndex: 0, timeSec: 1, confirmed: false }] },
  pages: [],
})

describe('useShiftNote after a play order edit that relabelled the locators', () => {
  it('says how many were relabelled while the timing is the one the edit made, and nothing after another edit', () => {
    const before = doc()
    const after: EditorDoc = { ...before, timing: { ...before.timing, locators: [...before.timing.locators] } }
    const names = barNamesOf(undefined)
    const { result, rerender } = renderHook(({ timing }) => useShiftNote(timing, names), { initialProps: { timing: before.timing } })

    act(() => result.current.afterEdit(before.timing, done(after, { kind: 'edit-play-order', count: 205 })))
    rerender({ timing: after.timing })
    expect(result.current.sentence).toBe(strings.editor.status.relabeled(205))

    rerender({ timing: { ...after.timing } })
    expect(result.current.sentence).toBeNull()
  })

  it('says nothing for a play order edit that relabelled none', () => {
    const before = doc()
    const names = barNamesOf(undefined)
    const { result } = renderHook(() => useShiftNote(before.timing, names))

    act(() => result.current.afterEdit(before.timing, done(before, { kind: 'edit-play-order' })))

    expect(result.current.sentence).toBeNull()
  })
})
