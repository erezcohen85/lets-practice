import { useState } from 'react'
import { createPortal } from 'react-dom'

const PREVIEW_WIDTH = 320
const MARGIN = 8
const GAP = 12
// A sheet of music is about 1.3 times as high as it is wide, until the picture says otherwise.
const DEFAULT_RATIO = 1.3

/**
 * The page picture at about 320 px, floating beside its tile while the pointer rests on the tile or it has keyboard
 * focus. It is drawn in the body, so a card, a dialog or a scroll area cannot clip it, at a fixed place beside the tile:
 * on the right, else on the left, and always inside the window. The picture is the same file as the tile's (rendered for
 * this size), so it needs no wait. Hidden from a screen reader: the tile's own picture already names the page.
 */
export function PagePreview({ anchor, src }: { anchor: DOMRect; src: string }) {
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const width = Math.min(PREVIEW_WIDTH, window.innerWidth - 2 * MARGIN)
  const height = Math.min(width * ratio, window.innerHeight - 2 * MARGIN)
  const right = anchor.right + GAP
  const left = right + width <= window.innerWidth - MARGIN ? right : Math.max(MARGIN, anchor.left - GAP - width)
  const centred = anchor.top + anchor.height / 2 - height / 2
  const top = Math.min(Math.max(MARGIN, centred), Math.max(MARGIN, window.innerHeight - MARGIN - height))

  return createPortal(
    <div
      data-page-preview=""
      aria-hidden="true"
      style={{ left, top, width }}
      className="pointer-events-none fixed z-[70] animate-in overflow-hidden rounded-lg border border-border-strong bg-white shadow-xl duration-100 fade-in-0 motion-reduce:animate-none"
    >
      <img
        src={src}
        alt=""
        className="block max-h-[calc(100dvh-1rem)] w-full object-contain"
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget
          if (naturalWidth > 0) setRatio(naturalHeight / naturalWidth)
        }}
      />
    </div>,
    document.body,
  )
}
