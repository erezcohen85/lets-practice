import { Hint } from '@/components/ui/hint'
import { Redo2, MousePointer2, SquareSplitHorizontal, SquareX, Undo2 } from 'lucide-react'
import { type ReactNode } from 'react'
import { type StepLabel } from '@/domain/history'
import { Button } from '@/components/ui/button'
import { ZoomControls } from '@/components/score/ZoomControls'
import { Switch } from '@/components/ui/switch'
import { useBarNames } from '@/lib/barNamesContext'
import { cn } from '@/lib/utils'
import { type EditMode } from '@/lib/useEditorDoc'
import { redoTooltip, strings, undoTooltip } from '@/strings'
import { BarsInBox } from './BarsInBox'
import { PieceEditSwitch } from './PieceEditSwitch'
import { type PieceEditingApi } from './usePieceEditing'

export interface EditSheetProps {
  mode: EditMode
  onModeChange(mode: EditMode): void
  undoLabel: StepLabel | null
  redoLabel: StepLabel | null
  onUndo(): void
  onRedo(): void
  /** The "Edit piece structure" switch of this visit, and the part shown (its warning names it). */
  pieceEditing: PieceEditingApi
  partName: string
  /** "Bars in box" for the selected bar, or null with no bar selected (the control is then shown off). */
  barsInBox: { count: number; onChange(count: number): void } | null
  /** The Pickup bar switch for the selected bar, or null with no bar selected (the switch is then shown off). */
  pickupBar: { on: boolean; onToggle(): void } | null
  /** The score's zoom, at the end of the row. */
  zoomPercent: number
  onZoomIn(): void
  onZoomOut(): void
}

/**
 * The classes of each compacting step, by the width of the sheet's content box (px), widest first: the label (1124), the Zoom word
 * (1018, in ZoomControls), the Bars in box word (974, in BarsInBox), the Pickup bar word (897), the tool names (822), two rows (679). Each is the measured width at
 * which the step before no longer fits on one row, plus 8 px; below 412 the gaps close up so row 1 of the two-row layout still fits. Complete class names, so Tailwind finds them.
 */
const COMPACT = {
  label: '@max-[1124px]:sr-only',
  tool: '@max-[822px]:w-9 @max-[822px]:px-0',
  toolName: '@max-[822px]:sr-only',
  rows: '@max-[679px]:flex-col @max-[679px]:items-start',
  second: 'min-w-0 flex-1 @max-[679px]:flex-none',
  // Below the row-1 width of the two-row layout (404 px measured) the gaps close up, so tools, Bars in box and Undo / Redo still share one row.
  tight: '@max-[412px]:gap-x-1',
  zoom: 'ms-auto @max-[679px]:ms-0',
}

const MODES: { mode: EditMode; icon: ReactNode }[] = [
  { mode: 'move', icon: <MousePointer2 aria-hidden /> },
  { mode: 'add', icon: <SquareSplitHorizontal aria-hidden /> },
  { mode: 'delete', icon: <SquareX aria-hidden /> },
]

/**
 * The EDIT BAR LINES bar above the score (board: Editor.png): the three tools, Bars in box, the Pickup bar switch, Undo and Redo, the Edit piece
 * switch and the score zoom. The hint of the mode sits in the status line above (ScoreView).
 * It only shows what it is given; the page owns the mode, the history and the settings. The Renumber switch lives on the
 * waveform and beside Structure's Insert / Remove, where it acts.
 */
export function EditSheet({
  mode,
  onModeChange,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  pieceEditing,
  partName,
  barsInBox,
  pickupBar,
  zoomPercent,
  onZoomIn,
  onZoomOut,
}: EditSheetProps) {
  const names = useBarNames()
  const undoText = undoTooltip(undoLabel, names)
  const redoText = redoTooltip(redoLabel, names)

  return (
    <section
      aria-label={strings.editor.sheet}
      data-slot="edit-sheet"
      className="@container rounded-card border border-border bg-surface px-3.5 py-2"
    >
      {/*
        One row for as long as it fits, by the width of this bar (container queries, not the window's): as room runs out
        the label, the Zoom word, the Bars in box word, the Pickup bar word and the tool names go, in that order (the thresholds are measured,
        see COMPACT). Last, two deliberate rows: tools, Bars in box and Undo / Redo; then Edit piece with Zoom after it.
      */}
      <div className={`flex items-center gap-x-2.5 gap-y-2 ${COMPACT.rows}`}>
        <div className={`flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 ${COMPACT.tight}`}>
          <span className={`text-xs font-semibold tracking-wider text-text-muted uppercase ${COMPACT.label}`}>{strings.editor.sheet}</span>
          <div className="flex shrink-0 items-center gap-2 @max-[412px]:gap-1">
            {MODES.map(({ mode: value, icon }) => (
              <Hint key={value} text={strings.editor.modes[value]}>
                <Button
                  variant={mode === value ? 'default' : 'outline'}
                  size="lg"
                  aria-pressed={mode === value}
                  aria-label={strings.editor.modes[value]}
                  aria-keyshortcuts={strings.editor.modeKeys[value]}
                  className={`rounded-xl ps-2.5 pe-3 text-[15px] ${COMPACT.tool}`}
                  onClick={() => onModeChange(value)}
                >
                  {icon}
                  <span className={COMPACT.toolName}>{strings.editor.modeLabels[value]}</span>
                </Button>
              </Hint>
            ))}
          </div>
          <BarsInBox count={barsInBox?.count ?? null} onChange={barsInBox?.onChange ?? noop} />
          <Hint text={strings.editor.pickupBar.tip} className="shrink-0 items-center gap-1.5 border-s border-border ps-2.5 @max-[412px]:ps-1.5">
            <span className={cn('text-sm @max-[897px]:sr-only', pickupBar === null ? 'text-text-muted' : 'text-text')}>{strings.editor.pickupBar.short}</span>
            <Switch
              checked={pickupBar?.on ?? false}
              disabled={pickupBar === null}
              onCheckedChange={pickupBar?.onToggle ?? noop}
              aria-label={strings.editor.pickupBar.label}
            />
          </Hint>
          <div className="flex shrink-0 items-center gap-2 @max-[412px]:gap-1">
            <Hint text={undoText}>
              <Button variant="outline" size="icon-lg" className="rounded-xl" disabled={undoLabel === null} aria-label={undoText} onClick={onUndo}>
                <Undo2 aria-hidden />
              </Button>
            </Hint>
            <Hint text={redoText}>
              <Button variant="outline" size="icon-lg" className="rounded-xl" disabled={redoLabel === null} aria-label={redoText} onClick={onRedo}>
                <Redo2 aria-hidden />
              </Button>
            </Hint>
          </div>
        </div>
        <div className={`flex items-center gap-x-2.5 ${COMPACT.second}`}>
          <PieceEditSwitch editing={pieceEditing} partName={partName} />
          <div className={`shrink-0 border-s border-border ps-2.5 ${COMPACT.zoom}`}>
            <ZoomControls percent={zoomPercent} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />
          </div>
        </div>
      </div>
    </section>
  )
}

function noop() {}
