import { TriangleAlert } from 'lucide-react'
import { strings } from '@/strings'

/** Shown while bars are still unchecked: practice is possible, checking the rest makes the cursor more exact. Edit map sits beside the Practice button. */
export function ReviewBanner({ checked, total }: { checked: number; total: number }) {
  return (
    <div
      data-slot="review-banner"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-warning-border bg-warning-bg px-5 py-4"
    >
      <TriangleAlert className="size-6 shrink-0 text-selected" strokeWidth={2} aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-60">
        <div className="text-base leading-[1.3] font-semibold text-warning-text">{strings.hub.reviewTitle(checked, total)}</div>
        <div className="mt-0.5 text-sm leading-[1.3] text-warning-text-soft">{strings.hub.reviewText}</div>
      </div>
    </div>
  )
}
