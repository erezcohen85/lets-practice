import { useSyncExternalStore } from 'react'
import { type CountLabelSpot } from '@/domain/countLabel'
import { type CursorColour } from '@/lib/dataClient'
import { cursorVar } from './cursorColour'
import { type FollowClock } from './followClock'

// Drawn in image pixels inside the scaled layer, like the cursor: sizes are screen pixels divided by the scale, so the
// count keeps its size at every zoom. 44 px is large enough to read from a music stand.
const FONT_PX = 44
const PAD_X_PX = 10
const PAD_Y_PX = 4
// Clear of the small bar number that the score draws just above the top edge of the box.
const GAP_PX = 20
const HEIGHT_PX = FONT_PX + 2 * PAD_Y_PX
// Half the width of a one-digit count, for keeping it inside the page at the left edge.
const HALF_WIDTH_PX = FONT_PX * 0.3 + PAD_X_PX

export interface CountLabelProps {
  /** The beat of the count-in as a number (0 when no count), shared so a beat redraws only this label and not the score. */
  clock: FollowClock
  pageIndex: number
  scale: number
  spot: CountLabelSpot | null
  colour: CursorColour
}

/**
 * During a count-in, the beat number above the start of the loop's first bar, where the gliding line begins, in the
 * cursor's colour. It sits above the box of the bar, never on the staff. The play button announces the count to a screen
 * reader, so this one is hidden from it.
 */
export function CountLabel({ clock, pageIndex, scale, spot, colour }: CountLabelProps) {
  const beat = useSyncExternalStore(clock.subscribe, clock.get)
  if (beat === 0 || spot === null || spot.pageIndex !== pageIndex) return null
  return (
    <div
      aria-hidden="true"
      data-slot="count-label"
      className="pointer-events-none absolute flex items-center justify-center rounded-md bg-background/90 leading-none font-bold tabular-nums"
      style={{
        left: Math.max(spot.x, HALF_WIDTH_PX / scale),
        top: Math.max(spot.y - GAP_PX / scale, HEIGHT_PX / scale),
        height: HEIGHT_PX / scale,
        paddingInline: PAD_X_PX / scale,
        fontSize: FONT_PX / scale,
        color: cursorVar[colour],
        transform: 'translate(-50%, -100%)',
      }}
    >
      {beat}
    </div>
  )
}
