/** The zoom a pinch can reach: 50 % shows a whole page in landscape, 200 % doubles the notes (iPad design P2). */
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2

/** The zoom after two fingers that started `startDistance` apart are now `distance` apart, between the limits. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return startZoom
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (startZoom * distance) / startDistance))
}

/**
 * The scroll that brings the point that was `from` px into the view, when the scroll was `scroll`, to `to` px into the view
 * once the content is `ratio` times the size: the point between the fingers stays between them.
 */
export function anchoredScroll(scroll: number, from: number, to: number, ratio: number): number {
  return Math.max(0, (scroll + from) * ratio - to)
}
