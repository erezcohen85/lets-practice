const AURORA_STOPS = 4

/**
 * The colour of tick `index` of `count`, by its angle along the aurora tokens: the first token at the top, the next ones
 * round the ring, and back to the first, so the ring has no seam. Tokens only, mixed where a tick sits between two.
 */
export function auroraTickColour(index: number, count: number): string {
  const along = (index / count) * AURORA_STOPS
  const from = Math.floor(along)
  const share = Math.round((along - from) * 100)
  const token = (stop: number) => `var(--lp-aurora-${(stop % AURORA_STOPS) + 1})`
  return share === 0 ? token(from) : `color-mix(in oklab, ${token(from)} ${100 - share}%, ${token(from + 1)})`
}
