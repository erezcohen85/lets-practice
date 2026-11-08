import { barUnderPoint } from '@/domain/barLineHits'
import { type BarBox, type BarNumber } from '@/domain/types'
import { type PageImage } from '@/lib/dataClient'

/**
 * The bar under a point of the window, read from where the score's pages are drawn now (the clef area and the gap before
 * a signature belong to the bar that follows); null off the score. For a drag that began on a handle, which may cross from one page to the next.
 */
export function barAtClientPoint(clientX: number, clientY: number, pages: readonly PageImage[], bars: readonly BarBox[]): BarNumber | null {
  for (const element of document.querySelectorAll<HTMLElement>('[data-slot="score-page"]')) {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue
    const pageIndex = Number(element.dataset.pageIndex)
    const image = pages.find((candidate) => candidate.pageIndex === pageIndex)
    if (image === undefined) return null
    const ratio = image.width / rect.width
    const x = (clientX - rect.left) * ratio
    const y = (clientY - rect.top) * ratio
    return barUnderPoint(bars, pageIndex, x, y)?.bar ?? null
  }
  return null
}
