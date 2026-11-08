import { act, renderHook, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { addBarLine, deleteBarLine, type EditorDoc, moveBarLine, type EditResult } from '@/domain/pieceEdits'
import { ClientsProvider } from '@/lib/clients'
import { createFakes, type Fakes } from '@/lib/fakes'
import { useEditorDoc } from '@/lib/useEditorDoc'

const PIECE_ID = 'piece-clark-county'

/** The Clark County piece on the fakes: its map as the editor loads it, and a hook rendered on it. */
async function setup() {
  const fakes = createFakes({ seed: 'demo' })
  const map = (await fakes.data.getPieceMap(PIECE_ID))!
  const initial: EditorDoc = { timing: map.timing, pages: map.pages }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ClientsProvider clients={{ data: fakes.data, processor: fakes.processor }}>{children}</ClientsProvider>
  )
  const view = renderHook(() => useEditorDoc(PIECE_ID, initial), { wrapper })
  const [clarinet, trumpet] = initial.pages.map((page) => page.partId)
  return { fakes, initial, clarinet, trumpet, ...view }
}

async function savedMap(fakes: Fakes) {
  return (await fakes.data.getPieceMap(PIECE_ID))!
}

/** Applies a result and fails the test when it is refused. */
function applyOk(result: { current: ReturnType<typeof useEditorDoc> }, edit: EditResult) {
  act(() => {
    expect(result.current.apply(edit)).toBeNull()
  })
}

describe('useEditorDoc', () => {
  it('starts on the initial doc, saved, with nothing to undo or redo', async () => {
    const { result, initial } = await setup()

    expect(result.current.doc).toBe(initial)
    expect(result.current.saveState).toBe('saved')
    expect(result.current.undoLabel).toBeNull()
    expect(result.current.redoLabel).toBeNull()
  })

  it('records an ok edit, saves only the layer that changed, and returns null', async () => {
    const { result, fakes, initial, clarinet } = await setup()
    const saveTiming = vi.spyOn(fakes.data, 'saveTiming')
    const savePageLayer = vi.spyOn(fakes.data, 'savePageLayer')

    const edit = addBarLine(initial, clarinet, 3, 800)
    applyOk(result, edit)

    expect(result.current.doc).toBe((edit as { doc: EditorDoc }).doc)
    expect(result.current.undoLabel).toEqual({ kind: 'add-bar-line', bar: 3 })
    await waitFor(() => expect(result.current.saveState).toBe('saved'))
    expect(saveTiming).not.toHaveBeenCalled()
    expect(savePageLayer).toHaveBeenCalledTimes(1)
    expect(savePageLayer).toHaveBeenCalledWith(PIECE_ID, result.current.doc.pages[0])
    expect((await savedMap(fakes)).pages[0].bars).toHaveLength(initial.pages[0].bars.length + 1)
  })

  it('shows saving while a save runs', async () => {
    const { result, fakes, initial, clarinet } = await setup()
    let finish: () => void = () => {}
    vi.spyOn(fakes.data, 'savePageLayer').mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))

    applyOk(result, addBarLine(initial, clarinet, 3, 800))
    await waitFor(() => expect(result.current.saveState).toBe('saving'))
    finish()

    await waitFor(() => expect(result.current.saveState).toBe('saved'))
  })

  it('returns the refusal and records and saves nothing', async () => {
    const { result, fakes, initial, clarinet } = await setup()
    const savePageLayer = vi.spyOn(fakes.data, 'savePageLayer')

    let refusal: ReturnType<typeof result.current.apply> = null
    act(() => {
      refusal = result.current.apply(addBarLine(initial, clarinet, 3, 625)) // 5 px from the line after bar 2
    })

    expect(refusal).toBe('too-narrow')
    expect(result.current.doc).toBe(initial)
    expect(result.current.undoLabel).toBeNull()
    expect(savePageLayer).not.toHaveBeenCalled()
  })

  it('records several applies in one go, each on the doc the one before made', async () => {
    const { result, initial, clarinet } = await setup()

    act(() => {
      const first = addBarLine(initial, clarinet, 3, 800)
      expect(result.current.apply(first)).toBeNull()
      if (!first.ok) return
      const second = deleteBarLine(first.doc, clarinet, 1)
      expect(result.current.apply(second)).toBeNull()
    })

    expect(result.current.undoLabel).toEqual({ kind: 'delete-bar-line', bar: 1 })
    act(() => result.current.undo())
    expect(result.current.undoLabel).toEqual({ kind: 'add-bar-line', bar: 3 })
    expect(result.current.redoLabel).toEqual({ kind: 'delete-bar-line', bar: 1 })
  })

  it('undoes and redoes to the exact docs and saves each one', async () => {
    const { result, fakes, initial, clarinet } = await setup()
    const edit = addBarLine(initial, clarinet, 3, 800)
    applyOk(result, edit)
    await waitFor(() => expect(result.current.saveState).toBe('saved'))
    const edited = result.current.doc

    act(() => result.current.undo())
    expect(result.current.doc).toBe(initial)
    expect(result.current.redoLabel).toEqual({ kind: 'add-bar-line', bar: 3 })
    await waitFor(() => expect(result.current.saveState).toBe('saved'))
    expect((await savedMap(fakes)).pages[0]).toEqual(initial.pages[0])

    act(() => result.current.redo())
    expect(result.current.doc).toBe(edited)
    await waitFor(() => expect(result.current.saveState).toBe('saved'))
    expect((await savedMap(fakes)).pages[0]).toEqual(edited.pages[0])
  })

  it('does nothing on undo and redo with nothing to undo or redo', async () => {
    const { result, fakes, initial } = await setup()
    const savePageLayer = vi.spyOn(fakes.data, 'savePageLayer')

    act(() => result.current.undo())
    act(() => result.current.redo())

    expect(result.current.doc).toBe(initial)
    expect(savePageLayer).not.toHaveBeenCalled()
  })

  it('records a new edit after an undo and drops the redo', async () => {
    const { result, initial, clarinet } = await setup()
    applyOk(result, addBarLine(initial, clarinet, 3, 800))
    act(() => result.current.undo())
    expect(result.current.redoLabel).not.toBeNull()

    applyOk(result, moveBarLine(initial, clarinet, 1, 400))

    expect(result.current.redoLabel).toBeNull()
  })

  it('replace records a whole doc as one step and saves the layers that changed', async () => {
    const { result, fakes, initial } = await setup()
    const saveTiming = vi.spyOn(fakes.data, 'saveTiming')
    const savePageLayer = vi.spyOn(fakes.data, 'savePageLayer')
    const locators = initial.timing.locators.map((locator) => ({ ...locator, timeSec: locator.timeSec + 1 }))
    const next: EditorDoc = { timing: { ...initial.timing, locators }, pages: initial.pages }

    act(() => result.current.replace(next, { kind: 'realign' }))

    expect(result.current.doc).toBe(next)
    expect(result.current.undoLabel).toEqual({ kind: 'realign' })
    await waitFor(() => expect(result.current.saveState).toBe('saved'))
    expect(saveTiming).toHaveBeenCalledWith(PIECE_ID, next.timing)
    expect(savePageLayer).not.toHaveBeenCalled()
  })

  describe('when a save fails', () => {
    it('keeps the edit, says failed, and saves the doc again on retry', async () => {
      const { result, fakes, initial, clarinet } = await setup()
      vi.spyOn(fakes.data, 'savePageLayer').mockRejectedValueOnce(new Error('offline'))

      applyOk(result, addBarLine(initial, clarinet, 3, 800))
      await waitFor(() => expect(result.current.saveState).toBe('failed'))
      const edited = result.current.doc
      expect(edited).not.toBe(initial)
      expect((await savedMap(fakes)).pages[0]).toEqual(initial.pages[0])

      act(() => result.current.retrySave())
      await waitFor(() => expect(result.current.saveState).toBe('saved'))
      expect(result.current.doc).toBe(edited)
      expect((await savedMap(fakes)).pages[0]).toEqual(edited.pages[0])
    })

    it('is cleared by the next edit that saves, which carries the unsaved one with it', async () => {
      const { result, fakes, initial, clarinet } = await setup()
      vi.spyOn(fakes.data, 'savePageLayer').mockRejectedValueOnce(new Error('offline'))
      applyOk(result, addBarLine(initial, clarinet, 3, 800))
      await waitFor(() => expect(result.current.saveState).toBe('failed'))

      applyOk(result, deleteBarLine(result.current.doc, clarinet, 1))

      await waitFor(() => expect(result.current.saveState).toBe('saved'))
      expect((await savedMap(fakes)).pages[0]).toEqual(result.current.doc.pages[0])
    })

    it('does not lose a timing change when only the page layer failed', async () => {
      const { result, fakes, initial } = await setup()
      const saveTiming = vi.spyOn(fakes.data, 'saveTiming')
      vi.spyOn(fakes.data, 'savePageLayer').mockRejectedValueOnce(new Error('offline'))
      const clarinet = initial.pages[0].partId
      const edit = addBarLine(initial, clarinet, 3, 800)
      const locators = initial.timing.locators.map((locator) => ({ ...locator, timeSec: locator.timeSec + 1 }))
      const both: EditorDoc = {
        timing: { ...initial.timing, locators },
        pages: edit.ok ? edit.doc.pages : initial.pages,
      }

      act(() => result.current.replace(both, { kind: 'realign' }))
      await waitFor(() => expect(result.current.saveState).toBe('failed'))
      expect(saveTiming).toHaveBeenCalledTimes(1)

      act(() => result.current.retrySave())
      await waitFor(() => expect(result.current.saveState).toBe('saved'))
      // The timing was saved the first time and is not saved again; the page layer is.
      expect(saveTiming).toHaveBeenCalledTimes(1)
      expect((await savedMap(fakes)).pages[0]).toEqual(both.pages[0])
    })
  })

  it('saves one at a time and newest last: a slow first save does not overwrite a newer second', async () => {
    const { result, fakes, initial, clarinet } = await setup()
    const events: string[] = []
    const releases: (() => void)[] = []
    const realSave = fakes.data.savePageLayer.bind(fakes.data)
    vi.spyOn(fakes.data, 'savePageLayer').mockImplementation(async (pieceId, page) => {
      const count = page.bars.length
      events.push(`start ${count}`)
      // The first save is slow; the later ones are not.
      if (releases.length === 0) await new Promise<void>((resolve) => releases.push(resolve))
      await realSave(pieceId, page)
      events.push(`end ${count}`)
    })

    const first = addBarLine(initial, clarinet, 3, 800)
    applyOk(result, first)
    await waitFor(() => expect(events).toEqual(['start 65']))
    applyOk(result, addBarLine(result.current.doc, clarinet, 1, 200))
    // The second edit waits: its save does not start while the first is running.
    await act(async () => {
      await Promise.resolve()
    })
    expect(events).toEqual(['start 65'])

    releases[0]()
    await waitFor(() => expect(result.current.saveState).toBe('saved'))

    expect(events).toEqual(['start 65', 'end 65', 'start 66', 'end 66'])
    expect((await savedMap(fakes)).pages[0].bars).toHaveLength(66)
  })

  it('saves the newest doc only when several edits pile up behind a slow save', async () => {
    const { result, fakes, initial, clarinet } = await setup()
    const sizes: number[] = []
    let release: () => void = () => {}
    const realSave = fakes.data.savePageLayer.bind(fakes.data)
    vi.spyOn(fakes.data, 'savePageLayer').mockImplementation(async (pieceId, page) => {
      sizes.push(page.bars.length)
      if (sizes.length === 1) await new Promise<void>((resolve) => (release = resolve))
      await realSave(pieceId, page)
    })

    applyOk(result, addBarLine(initial, clarinet, 3, 800))
    await waitFor(() => expect(sizes).toEqual([65]))
    applyOk(result, addBarLine(result.current.doc, clarinet, 1, 200))
    applyOk(result, addBarLine(result.current.doc, clarinet, 1, 150))
    release()

    await waitFor(() => expect(result.current.saveState).toBe('saved'))
    expect(sizes).toEqual([65, 67])
    expect((await savedMap(fakes)).pages[0].bars).toHaveLength(67)
  })
})

describe('useEditorDoc: one refused save does not hold the others back (Los Banditos, 2026-11-03)', () => {
  it('saves the other layers when the timing is refused, and Retry saves the timing', async () => {
    const { result, fakes, initial } = await setup()
    const saveTiming = vi.spyOn(fakes.data, 'saveTiming').mockRejectedValueOnce(new Error('refused'))
    const savePageLayer = vi.spyOn(fakes.data, 'savePageLayer')
    const next: EditorDoc = {
      timing: { ...initial.timing, marks: [] },
      pages: initial.pages.map((page, i) => (i === 0 ? { ...page, rests: [1] } : page)),
    }

    act(() => result.current.replace(next, { kind: 'edit-marks' }))

    await waitFor(() => expect(result.current.saveState).toBe('failed'))
    expect(savePageLayer).toHaveBeenCalledWith(PIECE_ID, next.pages[0])
    expect((await savedMap(fakes)).pages[0].rests).toEqual([1])

    act(() => result.current.retrySave())
    await waitFor(() => expect(result.current.saveState).toBe('saved'))
    expect(saveTiming).toHaveBeenCalledTimes(2)
    expect((await savedMap(fakes)).timing.marks).toEqual([])
  })
})
