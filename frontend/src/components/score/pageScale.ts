import { type PageImage } from '@/lib/dataClient'

/** Image pixel to screen pixel for one page at one zoom: the image is fitted to the column, then zoomed. */
export function pageScale(image: PageImage, columnWidth: number, zoom: number): number {
  return (columnWidth / image.width) * zoom
}
