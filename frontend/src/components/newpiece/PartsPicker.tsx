import { Loader2 } from 'lucide-react'
import { useId } from 'react'
import { PartRow } from '@/components/newpiece/PartRow'
import { PdfDropZone } from '@/components/newpiece/PdfDropZone'
import { SplitPanel } from '@/components/newpiece/SplitPanel'
import { SplitSummary } from '@/components/newpiece/SplitSummary'
import { type SplitChoice } from '@/components/newpiece/useSplitChoice'
import { isPdfFile, type PartRows } from '@/components/newpiece/usePartRows'
import { partErrorText } from '@/components/newpiece/partErrorText'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type NewPieceError } from '@/domain/newPiece'
import { usePlan, usePlanGate } from '@/lib/plan'
import { useFeatures } from '@/lib/useFeatures'
import { strings } from '@/strings'

const t = strings.newPiece
const s = strings.split

const modeButtonClass =
  'h-10 flex-1 rounded-lg border border-border px-3 text-sm text-text-soft aria-pressed:border-primary-strong aria-pressed:bg-surface-2 aria-pressed:font-medium aria-pressed:text-foreground'

/**
 * The PDF picker with its rows: the drop zone, what was skipped, and a row per PDF with its name to edit. `errors` is what
 * validateNewParts (or validateNewPiece) found: 'parts', and 'part-<index>' for a row. Shared by New piece and Add part.
 * A small switch beside it takes "one PDF with several parts" instead: that PDF is read by the processor, the split screen
 * takes its place until the parts are confirmed, and the kept parts then show as rows. Each way keeps what was chosen in it
 * when the switch is used, so nothing is lost by looking at the other. `attempted` is true once the form was submitted.
 * Each choice asks the plan first (the several-parts switch, another PDF, the Advanced Reading tick) and opens the "Not in your
 * plan" prompt when it is refused. `existing` is how many parts the piece has already (Add part).
 */
export function PartsPicker({
  rows,
  split,
  errors,
  attempted,
  existing = 0,
}: {
  rows: PartRows
  split: SplitChoice
  errors: Record<string, NewPieceError>
  attempted: boolean
  existing?: number
}) {
  const features = useFeatures()
  const gate = usePlanGate()
  const { state: plan } = usePlan()
  // The plan's page limit replaces the code's own 100 in the drop zone's hint (the admin has the code's).
  const pdfHint = plan === null || plan.is_admin || plan.plan.pages_per_part_max === null ? t.dropZoneLimits : strings.plans.pdfHint(plan.plan.name, plan.plan.pages_per_part_max)
  const ids = useId()
  const errorId = `${ids}-parts-error`
  const noteId = `${ids}-parts-note`
  const { parts, skipped } = rows
  const partsError = errors.parts === undefined ? undefined : partErrorText(errors.parts)
  const pending = split.active && (split.stage === 'review' || split.stage === 'reading' || split.stage === 'full-score')

  return (
    <>
      {features.splitPdf && (
        <ToggleGroup
          aria-label={s.modeLabel}
          value={[split.active ? 'split' : 'each']}
          onValueChange={(value) => {
            // Pressing the chosen one again would leave none: the choice stays.
            const next = value[0]
            if (next === 'split' && !gate.check({ type: 'splitPdf' })) return
            if (next === 'each' || next === 'split') split.setActive(next === 'split')
          }}
          className="w-full"
        >
          <ToggleGroupItem value="each" className={modeButtonClass}>
            {s.modeEach}
          </ToggleGroupItem>
          <ToggleGroupItem value="split" className={modeButtonClass}>
            {s.modeSplit}
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      {split.active ? (
        <>
          {split.stage === 'idle' && (
            <>
              <PdfDropZone
                onFiles={(files) => void split.choose(files)}
                invalid={partsError !== undefined || split.error !== null}
                describedBy={[partsError === undefined ? null : errorId, split.error === null ? null : noteId].filter(Boolean).join(' ') || undefined}
                label={s.dropZone}
                hint={s.dropZoneLimits}
                multiple={false}
              />
            </>
          )}
          {split.stage === 'reading' && (
            <p role="status" className="flex min-h-30 items-center justify-center gap-3 rounded-lg border border-border bg-surface/50 px-4 text-base text-text-soft">
              <Loader2 className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden="true" />
              {s.reading}
            </p>
          )}
          {split.stage === 'review' && split.proposal !== null && split.file !== null && <SplitPanel proposal={split.proposal} fileName={split.file.name} split={split} />}
          {split.stage === 'full-score' && (
            <div className="flex flex-col gap-3">
              <p role="alert" className="rounded-lg border border-problem-border bg-problem-bg px-4 py-3 text-sm text-problem">
                {s.fullScore}
              </p>
              <Button type="button" variant="outline" size="touch" onClick={() => split.discard()} className="self-start">
                {s.chooseAnother}
              </Button>
            </div>
          )}
          {split.stage === 'confirmed' && split.file !== null && <SplitSummary fileName={split.file.name} split={split} />}
          {split.error !== null && (
            <p id={noteId} role="alert" className="text-sm text-problem">
              {split.error}
            </p>
          )}
          {attempted && pending && split.stage !== 'full-score' && (
            <p role="alert" className="text-sm text-problem">
              {s.confirmFirst}
            </p>
          )}
          {partsError !== undefined && !pending && (
            <p id={errorId} className="text-sm text-problem">
              {partsError}
            </p>
          )}
        </>
      ) : (
        <>
          <PdfDropZone
            onFiles={(files) => {
              // The PDFs among them are the parts that would come; a file that is not a PDF is only named as skipped.
              const pdfs = files.filter(isPdfFile).length
              if (pdfs > 0 && !gate.check({ type: 'addPart', partsAfter: existing + parts.length + pdfs })) return
              rows.addFiles(files)
            }}
            hint={pdfHint}
            invalid={partsError !== undefined}
            describedBy={[partsError === undefined ? null : errorId, skipped.length > 0 ? noteId : null].filter(Boolean).join(' ') || undefined}
          />
          {partsError !== undefined && (
            <p id={errorId} className="text-sm text-problem">
              {partsError}
            </p>
          )}
          {skipped.length > 0 && (
            <p id={noteId} role="alert" className="text-sm text-warning-text">
              {t.notPdf(skipped.join(', '))}
            </p>
          )}
          {parts.length > 0 && (
            <ul className="flex flex-col gap-3">
              {parts.map((part, index) => {
                const code = errors[`part-${index}`]
                return (
                  <PartRow
                    key={part.key}
                    part={part}
                    error={code === undefined ? undefined : partErrorText(code)}
                    onNameChange={(name) => rows.changeName(part.key, name)}
                    onRemove={() => rows.removePart(part.key)}
                    boxCheck={
                      features.boxCheck
                        ? {
                            checked: rows.boxChecks.has(part.key),
                            onToggle: () => {
                              // Ticking asks for one more Advanced Reading part than the ticked ones; unticking never asks.
                              if (!rows.boxChecks.has(part.key) && !gate.check({ type: 'advancedReading', parts: rows.boxChecks.size + 1 })) return
                              rows.toggleBoxCheck(part.key)
                            },
                          }
                        : undefined
                    }
                  />
                )
              })}
            </ul>
          )}
        </>
      )}
    </>
  )
}
