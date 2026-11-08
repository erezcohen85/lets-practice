import { strings } from '@/strings'

const text = strings.review.queue

const percentOf = (part: number, total: number) => `${total === 0 ? 0 : (part / total) * 100}%`

export interface ReviewProgressProps {
  checked: number
  /** Dragged by hand and not resolved yet: drawn hatched after the checked part. */
  moved: number
  total: number
}

/** The thin bar under "x of y checked": the checked items in the primary colour, the moved ones hatched. */
export function ReviewProgress({ checked, moved, total }: ReviewProgressProps) {
  return (
    <div
      role="progressbar"
      aria-label={text.progress}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={checked}
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
    >
      <div data-slot="review-progress-checked" className="h-full bg-primary-strong" style={{ inlineSize: percentOf(checked, total) }} />
      {moved > 0 && (
        <div
          data-slot="review-progress-moved"
          className="h-full bg-[repeating-linear-gradient(135deg,var(--lp-moved)_0_3px,transparent_3px_6px)]"
          style={{ inlineSize: percentOf(moved, total) }}
        />
      )}
    </div>
  )
}
