import { useState } from 'react'
import { useEditLayer } from '@/components/score/useEditLayer'
import { type ClickMode } from '@/domain/types'
import { type EditMode, type EditorDocApi } from '@/lib/useEditorDoc'
import { strings } from '@/strings'
import { useEditorKeys } from './useEditorKeys'
import { useRefusalHint } from './useRefusalHint'

/**
 * Everything the score needs from the Edit sheet for one part: the mode (view state, never recorded), the keys, the
 * pointer handler and overlay for ScoreView, and the hint line (the mode's hint, which Move has none of, or the reason a refused edit gave).
 * An ok edit goes to the doc, which records and saves it.
 */
export function useScoreEditing(
  editor: EditorDocApi,
  partId: string,
  pieceMode: ClickMode | null = null,
  partName = '',
  pageWidth?: (pageIndex: number) => number | undefined,
) {
  const [mode, setMode] = useState<EditMode>('move')
  const refusal = useRefusalHint()
  const { onPointer, overlay } = useEditLayer({
    mode,
    doc: editor.doc,
    partId,
    pieceMode,
    pageWidth,
    onResult: (result) => {
      const reason = editor.apply(result)
      if (reason !== null) refusal.show(reason)
    },
  })
  useEditorKeys({ onMode: setMode, onUndo: editor.undo, onRedo: editor.redo })

  // Move needs no hint (the line stays empty until an edit is refused); Add and Delete say what the click does, and that it
  // reaches the whole piece while Edit piece structure is on.
  const pieceHint = mode === 'add' ? strings.editor.pieceEditing.hintAdd(partName) : strings.editor.pieceEditing.hintDelete(partName)
  const modeHint = mode === 'move' ? '' : pieceMode !== null ? pieceHint : strings.editor.hints[mode]
  return { mode, setMode, onPointer, overlay, hint: refusal.hint ?? modeHint, showRefusal: refusal.show, showText: refusal.showText }
}
