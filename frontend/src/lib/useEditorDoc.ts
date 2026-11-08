import { useCallback, useRef, useState } from 'react'
import { type EditorDoc, type EditRefusal, type EditResult } from '@/domain/pieceEdits'
import { canRedo, canUndo, createHistory, nextRedo, nextUndo, record, redo, undo, type History, type StepLabel } from '@/domain/history'
import { useClients } from '@/lib/clients'

export type SaveState = 'saved' | 'saving' | 'failed'

/** What the Edit sheet is doing with the pointer. View state: never recorded in the history. */
export type EditMode = 'move' | 'add' | 'delete'

export interface EditorDocApi {
  doc: EditorDoc
  /** Records an ok result and saves it; a refused one records nothing and gives its reason back. */
  apply(result: EditResult): EditRefusal | null
  undo(): void
  redo(): void
  undoLabel: StepLabel | null
  redoLabel: StepLabel | null
  saveState: SaveState
  /** Saves again what the last failed save left behind. */
  retrySave(): void
  /** Records a whole new doc as one step (the realign). */
  replace(doc: EditorDoc, label: StepLabel): void
}

/**
 * The editor's document: one history for the piece while the Editor is open, saved through the DataClient after every
 * apply, undo and redo.
 *
 * - Saves go one after the other, so an older save can never land after a newer one. While one runs, the doc moves on;
 *   when it ends, the newest doc is saved next (the ones in between are skipped, since the newest carries them).
 * - A save writes only the layers that changed against what was last saved: the timing and each page, compared by
 *   reference (an edit keeps the reference of every layer it did not change). A layer counts as saved the moment its
 *   own save succeeds, so a retry does not repeat it.
 * - A failed save keeps the doc on screen and leaves the layers unsaved: `saveState` is 'failed' until a later save
 *   (the next edit, or retrySave) gets through. The editor never reverts an edit because it could not be saved.
 */
export function useEditorDoc(pieceId: string, initial: EditorDoc): EditorDocApi {
  const { data } = useClients()
  const [history, setHistory] = useState<History<EditorDoc>>(() => createHistory(initial))
  const [saveState, setSaveState] = useState<SaveState>('saved')
  // The same history, readable at once: several applies in one event each build on the one before.
  const historyRef = useRef(history)
  const saved = useRef(initial)
  const running = useRef(false)

  const flush = useCallback(async () => {
    if (running.current) return // the running loop picks the newest doc up when its save ends
    running.current = true
    setSaveState('saving')
    // Each layer is saved on its own: one that is refused does not hold the others back (a refused timing must not
    // keep a corrected page from being sent; Los Banditos, 2026-11-03). A pass with a failure stops the loop; Retry
    // saves what is left.
    let failed = false
    const attempt = async (save: () => Promise<void>, done: () => void) => {
      try {
        await save()
        done()
      } catch {
        failed = true
      }
    }
    try {
      while (!failed && saved.current !== historyRef.current.present) {
        const target = historyRef.current.present
        if (target.timing !== saved.current.timing) {
          await attempt(
            () => data.saveTiming(pieceId, target.timing),
            () => (saved.current = { ...saved.current, timing: target.timing }),
          )
        }
        if ((target.structureSetAt ?? null) !== (saved.current.structureSetAt ?? null)) {
          await attempt(
            () => data.saveStructureSetAt(pieceId, target.structureSetAt ?? null),
            () => (saved.current = { ...saved.current, structureSetAt: target.structureSetAt }),
          )
        }
        for (const page of target.pages) {
          if (saved.current.pages.includes(page)) continue
          await attempt(
            () => data.savePageLayer(pieceId, page),
            () =>
              (saved.current = {
                ...saved.current,
                pages: saved.current.pages.some((existing) => existing.partId === page.partId)
                  ? saved.current.pages.map((existing) => (existing.partId === page.partId ? page : existing))
                  : [...saved.current.pages, page],
              }),
          )
        }
        // All of this target is saved; if the doc moved on meanwhile, the loop goes round again.
        if (!failed) saved.current = target
      }
      setSaveState(failed ? 'failed' : 'saved')
    } finally {
      running.current = false
    }
  }, [data, pieceId])

  const commit = useCallback(
    (next: History<EditorDoc>) => {
      if (next === historyRef.current) return
      historyRef.current = next
      setHistory(next)
      void flush()
    },
    [flush],
  )

  const apply = useCallback(
    (result: EditResult): EditRefusal | null => {
      if (!result.ok) return result.reason
      commit(record(historyRef.current, result.label, result.doc))
      return null
    },
    [commit],
  )

  return {
    doc: history.present,
    apply,
    undo: useCallback(() => commit(undo(historyRef.current)), [commit]),
    redo: useCallback(() => commit(redo(historyRef.current)), [commit]),
    undoLabel: canUndo(history) ? nextUndo(history) : null,
    redoLabel: canRedo(history) ? nextRedo(history) : null,
    saveState,
    retrySave: useCallback(() => void flush(), [flush]),
    replace: useCallback((doc, label) => commit(record(historyRef.current, label, doc)), [commit]),
  }
}
