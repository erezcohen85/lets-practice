import { useMemo, useRef, useState, type ReactNode } from 'react'
import { barAt, barLineAt, gapBetween, lineEdgeAt, type BarLineGeometry, type LineEdge } from '@/domain/barLineHits'
import { addBarLineInPiece, boxGroup, deleteBarLineInPiece } from '@/domain/boxEdits'
import { addBarLine, deleteBarLine, type EditorDoc, type EditResult, MIN_BOX_WIDTH, moveBarLine, moveLineEnd, moveLineStart, refuse } from '@/domain/pieceEdits'
import { type ClickMode } from '@/domain/types'
import { type EditMode } from '@/lib/useEditorDoc'
import { strings } from '@/strings'
import { EditLayerOverlay, type EditHover } from './EditLayer'
import { type ScorePointerEvent } from './ScorePage'

/** A press and release this far apart or less, in image pixels, is a click; farther is a scroll or a drag. */
export const CLICK_SLOP = 6
/** A drag that ends this close to where the line was, in image pixels, moved nothing: it was a click on the line. */
const MOVE_EPSILON = 1

export interface EditLayerOptions {
  mode: EditMode
  doc: EditorDoc
  /** The part shown: edits change only its boxes. */
  partId: string
  /** Every edit the pointer asks for, ok or refused; the page applies it and shows a refusal's reason. */
  onResult(result: EditResult): void
  /** With "Edit piece structure" on, the Renumber setting: Add and Delete then change the piece too. Null: this part only. */
  pieceMode?: ClickMode | null
  /** The width of a page's image in pixels, the farthest the end of a line may be dragged; unknown: no limit. */
  pageWidth?(pageIndex: number): number | undefined
}

/**
 * `edge` set: the drag moves the start (line.x is the box's left edge) or the end (line.x is its right edge) of the
 * line whose first box is `line.bar` or whose last box is `line.bar`.
 */
interface Drag { line: BarLineGeometry; min: number; max: number; edge: LineEdge | null }

/**
 * The Edit sheet's pointer handling on the score: turns the score's pointer events and the part's boxes into
 * `addBarLine` / `deleteBarLine` / `moveBarLine` / `moveLineStart` / `moveLineEnd` results, and draws the hover
 * feedback in each page's overlay layer.
 *
 * - Move: hover a bar line, or the start or the end of a line of music, for the drag handle; press on it and drag to
 *   preview; release applies. A drag that leaves the page or ends over another page is cancelled.
 * - Add: a click (press and release in place) on a bar line removes it, elsewhere inside a bar splits it at that x.
 *   Delete: a click on a bar line removes it; inside a bar it does nothing.
 *   Shift has no effect: Shift+click is for the waveform's locators.
 */
export function useEditLayer({ mode, doc, partId, onResult, pieceMode = null, pageWidth }: EditLayerOptions) {
  // The hover remembers its mode, so a mode change drops it without an effect.
  const [hover, setHover] = useState<{ mode: EditMode; shown: EditHover } | null>(null)
  const drag = useRef<Drag | null>(null)
  const press = useRef<{ pageIndex: number; x: number; y: number } | null>(null)
  const boxes = useMemo(() => doc.pages.find((page) => page.partId === partId)?.bars ?? [], [doc, partId])

  function show(shown: EditHover | null) {
    setHover(shown === null ? null : { mode, shown })
  }

  function startDrag(line: BarLineGeometry) {
    const left = boxes.find((box) => box.bar === line.bar)
    const right = boxes.find((box) => box.bar === line.bar + 1)
    if (left === undefined || right === undefined) return
    // A bar that starts after a signature keeps its gap, so the line cannot go past the room the right box needs.
    drag.current = { line, min: left.x, max: right.x + right.w - (gapBetween(left, right) ?? 0), edge: null }
    show({ kind: 'handle', pageIndex: line.pageIndex, x: line.x, y: line.y, h: line.h, dragging: true })
  }

  function startDragOfEdge(line: BarLineGeometry, edge: LineEdge) {
    const box = boxes.find((existing) => existing.bar === line.bar)
    if (box === undefined) return
    // The start may go to the page edge or up to the minimum width before the end of its box; the end, from the
    // minimum width after the start of its box up to the page edge (unknown: as far as the page can be pointed at).
    drag.current =
      edge === 'start'
        ? { line, min: 0, max: box.x + box.w - MIN_BOX_WIDTH, edge }
        : { line, min: box.x + MIN_BOX_WIDTH, max: pageWidth?.(line.pageIndex) ?? Infinity, edge }
    show({ kind: 'handle', pageIndex: line.pageIndex, x: line.x, y: line.y, h: line.h, dragging: true })
  }

  function hoverAt({ pageIndex, x, y }: ScorePointerEvent) {
    const line = barLineAt(boxes, pageIndex, x, y)
    const edge = mode === 'move' && line === null ? lineEdgeAt(boxes, pageIndex, x, y) : null
    if (edge !== null) {
      show({ kind: 'handle', pageIndex, x: edge.x, y: edge.y, h: edge.h, dragging: false })
      return
    }
    if (mode === 'add' && line === null) {
      const box = barAt(boxes, pageIndex, x, y)
      show(box === null ? null : { kind: 'add', pageIndex, x, y: box.y, h: box.h, pointerY: y })
      return
    }
    if (line === null) show(null)
    else if (mode === 'move') show({ kind: 'handle', pageIndex, x: line.x, y: line.y, h: line.h, dragging: false })
    else show({ kind: 'delete', pageIndex, x: line.x, y: line.y, h: line.h })
  }

  function moveResult(dragged: Drag, x: number): EditResult {
    const { line, edge } = dragged
    if (edge === 'start') return moveLineStart(doc, partId, line.bar, x)
    if (edge === 'end') return moveLineEnd(doc, partId, line.bar, x, pageWidth?.(line.pageIndex))
    return moveBarLine(doc, partId, line.bar, x)
  }

  function release(event: ScorePointerEvent) {
    const dragged = drag.current
    drag.current = null
    if (dragged !== null) {
      show(null)
      const { line } = dragged
      if (event.pageIndex === line.pageIndex && Math.abs(event.x - line.x) > MOVE_EPSILON) {
        onResult(moveResult(dragged, event.x))
      }
      return
    }
    const pressed = press.current
    press.current = null
    if (pressed === null || pressed.pageIndex !== event.pageIndex) return
    if (Math.hypot(event.x - pressed.x, event.y - pressed.y) > CLICK_SLOP) return
    if (mode === 'move') return
    // On a bar line a click removes it, in Add mode as well; elsewhere in a bar Add mode splits it.
    const line = barLineAt(boxes, event.pageIndex, event.x, event.y)
    if (line !== null) {
      onResult(pieceMode === null ? deleteBarLine(doc, partId, line.bar) : deleteBarLineInPiece(doc, partId, line.bar, pieceMode))
    } else if (mode === 'add') {
      const box = barAt(boxes, event.pageIndex, event.x, event.y)
      if (box === null) return
      const page = doc.pages.find((existing) => existing.partId === partId)
      if (page !== undefined && boxGroup(page, box.bar).length > 1) onResult(refuse('in-multi-rest'))
      else onResult(pieceMode === null ? addBarLine(doc, partId, box.bar, event.x) : addBarLineInPiece(doc, partId, box.bar, event.x, pieceMode))
    }
  }

  function onPointer(event: ScorePointerEvent) {
    switch (event.type) {
      case 'leave':
        drag.current = null
        press.current = null
        show(null)
        return
      case 'down': {
        const line = mode === 'move' ? barLineAt(boxes, event.pageIndex, event.x, event.y) : null
        const edge = mode === 'move' && line === null ? lineEdgeAt(boxes, event.pageIndex, event.x, event.y) : null
        if (line !== null) startDrag(line)
        else if (edge !== null) startDragOfEdge(edge, edge.edge)
        else press.current = { pageIndex: event.pageIndex, x: event.x, y: event.y }
        return
      }
      case 'move': {
        const dragged = drag.current
        if (dragged === null) {
          hoverAt(event)
        } else if (event.pageIndex === dragged.line.pageIndex) {
          const x = Math.min(Math.max(event.x, dragged.min), dragged.max)
          const { line } = dragged
          show({ kind: 'handle', pageIndex: line.pageIndex, x, y: line.y, h: line.h, dragging: true })
        }
        return
      }
      case 'up':
        release(event)
        return
    }
  }

  const overlay = (pageIndex: number, scale: number): ReactNode =>
    hover !== null && hover.mode === mode && hover.shown.pageIndex === pageIndex ? (
      <EditLayerOverlay hover={hover.shown} scale={scale} addHere={strings.editor.addHere} moveHandle={strings.editor.moveHandle} />
    ) : null

  return { onPointer, overlay }
}
