import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { continueEdit, type RegridEdit } from '@/components/waveform/regridEdit'
import { LABEL_ROW } from '@/components/waveform/LocatorLayer'
import { type DetectedBeat } from '@/domain/beats'
import { type EditorDoc, type EditRefusal } from '@/domain/pieceEdits'
import { planContinue, type ContinuePlan, type RegridPlan } from '@/domain/regridEdits'
import { type TimingLayer } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { type ContinueMode } from '@/lib/dataClient'
import { strings } from '@/strings'

const text = strings.dock.grid

/** Going on is worth offering (or doing by itself) when it would change at least this many lines: adds and deletes together. */
const MIN_CHANGES = 2

/** The run a plan goes on from, named by the slot of its last line: what "not now" and "once" are kept against. */
const runOf = (learned: ContinuePlan): string => `${learned.lastBar}:${learned.lastPassIndex}`

export interface ContinuePromptProps {
  timing: TimingLayer
  beats: readonly DetectedBeat[] | null
  durationSec: number
  /** Settings > Editing > Continue from my bars. 'button' (and a dock that is not editing) offers nothing and does nothing. */
  mode: ContinueMode
  editing: boolean
  /** The dock's own edit, the one the toolbar's Continue sends, so the message and the Undo step are the same. */
  onEdit(edit: RegridEdit): EditRefusal | null
  /** The lines Continue would put on the waveform, while the pointer or the keyboard is on the panel's Continue; null when none. */
  onPreview(plan: RegridPlan | null): void
}

/**
 * Continue from my bars, offered or done for the player. Once 3 bars in a row are checked by ear and going on from them would
 * change at least two bar lines:
 * - 'ask': a small panel over the top of the waveform (it never pushes the waveform or the toolbar) offers Continue, or Not now;
 *   Not now, Escape (with the focus on the panel) and Continue each hide it for that run, until a longer run is checked (state of
 *   this screen only).
 * - 'auto': an edit that has just checked one of the lines the plan learns from is followed by Continue at once, once for each
 *   run; opening the Editor and unchecking a line never do. Undo of an uncheck (and Redo of a check) puts a checked line back, so
 *   it can start Continue too: a known follow-up. Undo of a check, and Undo of Continue itself, do not.
 * - 'button': nothing; the toolbar's Continue is there for it.
 * A run is named by the slot of its last checked line, so Undo after Continue does not bring the question back.
 */
export function ContinuePrompt({ timing, beats, durationSec, mode, editing, onEdit, onPreview }: ContinuePromptProps) {
  const names = useBarNames()
  const label = useCallback((bar: number): string => names.label(bar), [names])
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set())
  const settle = useCallback((run: string) => setSettled((now) => new Set(now).add(run)), [])

  const doc = useMemo<EditorDoc>(() => ({ timing, pages: [] }), [timing])
  const active = editing && mode !== 'button' && beats !== null && beats.length >= 2
  const learned = useMemo(() => (active ? planContinue(doc, beats, durationSec) : null), [active, doc, beats, durationSec])
  const offered = learned !== null && learned.plan.adds.length + learned.plan.deletes.length >= MIN_CHANGES ? learned : null
  const run = offered === null ? null : runOf(offered)

  // What the last run of the effect saw. The plan is made by an edit when the doc changed, the run is a new one, and one of the
  // lines it learns from was not checked before the change: a line was just checked. A plan already waiting when the Editor opened
  // (or when the beats arrived) is not that, nor is the Undo of a check, an unchecked line, or the Editor filling in bars.
  const seen = useRef({ timing, run })
  useEffect(() => {
    const before = seen.current
    seen.current = { timing, run }
    if (mode !== 'auto' || offered === null || run === null || beats === null) return
    if (before.timing === timing || before.run === run || settled.has(run)) return
    const checkedBefore = new Set(before.timing.locators.filter((l) => l.confirmed).map((l) => l.timeSec))
    if (offered.learnedTimes.every((timeSec) => checkedBefore.has(timeSec))) return
    settle(run)
    onEdit(continueEdit(offered, beats, label))
  }, [mode, timing, run, offered, beats, settled, settle, onEdit, label])

  if (mode !== 'ask' || offered === null || run === null || beats === null || settled.has(run)) return null
  return (
    <Panel
      learned={offered}
      label={label}
      onContinue={() => {
        settle(run)
        onEdit(continueEdit(offered, beats, label))
      }}
      onNotNow={() => settle(run)}
      onPreview={onPreview}
    />
  )
}

/** The panel itself: a sentence and two buttons, in the More menu's look, over the top of the waveform below its bar labels. */
function Panel({ learned, label, onContinue, onNotNow, onPreview }: { learned: ContinuePlan; label: (bar: number) => string; onContinue(): void; onNotNow(): void; onPreview(plan: RegridPlan | null): void }) {
  const [resting, setResting] = useState(false)
  const { plan } = learned
  useEffect(() => {
    if (!resting) return
    onPreview(plan)
    return () => onPreview(null)
  }, [resting, plan, onPreview])

  // Escape closes it like Not now, but only with the keyboard focus on the panel (its buttons). Anywhere else Escape keeps doing the
  // dock's own job (clear the selection, cancel a drag, turn Add locator off); here the first Escape does only this one.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.stopPropagation()
    onNotNow()
  }
  const sentenceId = useId()

  return (
    <div
      role="status"
      aria-label={text.promptRegion}
      data-slot="continue-prompt"
      onKeyDown={onKeyDown}
      className="absolute inset-x-0 z-10 mx-auto flex w-fit max-w-[calc(100%-1rem)] flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-sm text-text shadow-[0_12px_32px_color-mix(in_oklab,var(--lp-ink)_45%,transparent)]"
      style={{ top: LABEL_ROW + 4 }}
    >
      <span id={sentenceId}>{text.prompt(label(learned.firstBar), label(learned.lastBar), learned.beatsPerBar, label(learned.endBar))}</span>
      <span className="flex items-center gap-2">
        <Button
          size="sm"
          aria-describedby={sentenceId}
          onClick={onContinue}
          onPointerEnter={() => setResting(true)}
          onPointerLeave={() => setResting(false)}
          onFocus={() => setResting(true)}
          onBlur={() => setResting(false)}
        >
          {text.promptContinue}
        </Button>
        <Button variant="outline" size="sm" onClick={onNotNow}>
          {text.promptNotNow}
        </Button>
      </span>
    </div>
  )
}
