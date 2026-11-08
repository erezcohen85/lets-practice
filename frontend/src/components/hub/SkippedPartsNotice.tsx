import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type SkippedPart } from '@/domain/processingSteps'
import { strings } from '@/strings'

/** The parts the last job could not read, each with its reason; the others were read. Try again reads them once more. */
export function SkippedPartsNotice({
  parts,
  retrying,
  retryFailed,
  refusal = null,
  onRetry,
}: {
  parts: SkippedPart[]
  retrying: boolean
  retryFailed: boolean
  /** The sentence the processor refused the retry with, shown in place of the generic one. */
  refusal?: string | null
  onRetry: () => void
}) {
  return (
    <div role="alert" data-slot="skipped-parts" className="flex flex-wrap items-start gap-4 rounded-lg border border-problem-border bg-problem-bg px-5 py-4">
      <CircleAlert className="size-6 shrink-0 text-problem" strokeWidth={2} aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-60">
        <div className="text-base leading-[1.3] font-semibold text-text">{strings.hub.skippedTitle(parts.length)}</div>
        <ul className="mt-1 flex flex-col gap-0.5 text-sm leading-[1.3] text-text-soft">
          {parts.map((part) => (
            <li key={part.id}>{strings.hub.skippedPart(part.name, part.error)}</li>
          ))}
        </ul>
        <div className="mt-1 text-sm leading-[1.3] text-text-muted">{strings.hub.skippedText(parts.length)}</div>
        {retryFailed && <div className="mt-1 text-sm leading-[1.3] text-problem">{refusal ?? strings.hub.skippedRetryFailed}</div>}
      </div>
      <Button variant="outline" size="touch" disabled={retrying} onClick={onRetry}>
        {strings.common.retry}
      </Button>
    </div>
  )
}
