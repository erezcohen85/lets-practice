import { X } from 'lucide-react'
import { useId } from 'react'
import { AdvancedReadingTick } from '@/components/newpiece/AdvancedReadingTick'
import { type SplitChoice } from '@/components/newpiece/useSplitChoice'
import { Button } from '@/components/ui/button'
import { pageRuns } from '@/domain/splitEdits'
import { usePlanGate } from '@/lib/plan'
import { useFeatures } from '@/lib/useFeatures'
import { strings } from '@/strings'

const t = strings.split

/** The parts taken from the PDF, back in the form: a row each (name and pages, the Advanced Reading tick) that can be removed, and a way to open the split screen again. */
export function SplitSummary({ fileName, split }: { fileName: string; split: SplitChoice }) {
  const fileId = useId()
  const features = useFeatures()
  const gate = usePlanGate()
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p id={fileId} className="truncate text-[13px] leading-[1.3] text-text-muted">
          {t.fromPdf(fileName)}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={split.reopen} className="h-9 px-3 text-primary-strong hover:text-primary-strong">
          {t.change}
        </Button>
      </div>
      <ul className="flex flex-col gap-3">
        {split.parts.map((part, index) =>
          part.keep ? (
            <li key={index} className="flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3">
              <p className="order-1 min-w-0 flex-1 truncate text-base">
                <span className="font-medium">{part.name.trim()}</span>
                <span className="text-text-soft"> · {t.pages(pageRuns(part))}</span>
              </p>
              {features.boxCheck && (
                <AdvancedReadingTick checked={split.boxChecks.has(index)} onToggle={() => {
                    // Ticking asks for one more Advanced Reading part than the ticked ones; unticking never asks.
                    if (!split.boxChecks.has(index) && !gate.check({ type: 'advancedReading', parts: split.boxChecks.size + 1 })) return
                    split.toggleBoxCheck(index)
                  }} className="order-3 w-full sm:order-2 sm:w-auto" />
              )}
              <Button
                type="button"
                variant="outline"
                aria-label={t.removePart}
                aria-describedby={fileId}
                onClick={() => split.removeConfirmed(index)}
                className="order-2 size-11 border-border bg-transparent text-text-soft sm:order-3 dark:border-border dark:bg-transparent dark:hover:bg-muted"
              >
                <X className="size-[18px]" strokeWidth={2} aria-hidden="true" />
              </Button>
            </li>
          ) : null,
        )}
      </ul>
    </>
  )
}
