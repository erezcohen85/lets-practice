import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { strings } from '@/strings'

/** The last Realign or Add part ended in an error, with the sentence the job holds; the rest of the hub still works. */
export function JobFailedNotice({
  kind,
  error,
  retrying,
  retryFailed,
  refusal = null,
  onRetry,
}: {
  kind: 'realign' | 'add-parts'
  error: string | null
  retrying: boolean
  retryFailed: boolean
  /** The sentence the processor refused the retry with, shown in place of the generic one. */
  refusal?: string | null
  onRetry: () => void
}) {
  return (
    <div role="alert" data-slot="job-failed" className="flex flex-wrap items-start gap-4 rounded-lg border border-problem-border bg-problem-bg px-5 py-4">
      <CircleAlert className="size-6 shrink-0 text-problem" strokeWidth={2} aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-60">
        <div className="text-base leading-[1.3] font-semibold text-text">{strings.hub.jobFailedTitle(kind)}</div>
        {error !== null && error !== '' && <div className="mt-1 text-sm leading-[1.3] text-text-soft">{error}</div>}
        <div className="mt-1 text-sm leading-[1.3] text-text-muted">{strings.hub.jobFailedText}</div>
        {retryFailed && <div className="mt-1 text-sm leading-[1.3] text-problem">{refusal ?? strings.hub.retryFailed}</div>}
      </div>
      <Button variant="outline" size="touch" disabled={retrying} onClick={onRetry}>
        {strings.common.retry}
      </Button>
    </div>
  )
}
