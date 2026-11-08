export type PartReviewState = 'not-reviewed' | 'partly-reviewed' | 'all-checked'

/** Nothing checked (or nothing to check yet) → not-reviewed; every bar checked → all-checked; in between → partly-reviewed. */
export function partReviewState(review: { checked: number; total: number }): PartReviewState {
  if (review.checked <= 0) return 'not-reviewed'
  return review.checked >= review.total ? 'all-checked' : 'partly-reviewed'
}
