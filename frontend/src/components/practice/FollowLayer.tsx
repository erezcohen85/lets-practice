import { useSyncExternalStore } from 'react'
import { cursorAt, type SlotTiming } from '@/domain/tempo'
import { type PageLayer } from '@/domain/types'
import { type FollowSettings } from '@/lib/dataClient'
import { cursorVar } from './cursorColour'
import { type FollowClock } from './followClock'

// The box and the line are drawn in image pixels inside the scaled layer: widths are screen pixels divided by the scale,
// so they keep their weight at every zoom.
const BOX_BORDER_PX = 2
const LINE_PX = 2

export interface FollowLayerProps {
  clock: FollowClock
  pageIndex: number
  scale: number
  page: PageLayer
  timeline: SlotTiming[]
  follow: FollowSettings
  /** Draws the box this many screen pixels inside the bar box, so a box drawn on the bar box itself (the Editor's selection) shows around it. Default 0. */
  inset?: number
}

/**
 * On one page of the score: the box around the bar being played and the line gliding through it, each only when the
 * settings have it on, in the colour the settings name. The layer reads the clock itself, so a frame redraws these two
 * small elements and not the score. Nothing is drawn on a page that does not hold the cursor.
 */
export function FollowLayer({ clock, pageIndex, scale, page, timeline, follow, inset = 0 }: FollowLayerProps) {
  const timeSec = useSyncExternalStore(clock.subscribe, clock.get)
  const cursor = cursorAt(timeline, page, timeSec)
  if (cursor === null || cursor.pageIndex !== pageIndex || (!follow.box && !follow.line)) return null
  const { box, fraction } = cursor
  const gap = inset / scale

  return (
    <>
      {follow.box && (
        <div
          data-slot="follow-box"
          data-bar={box.bar}
          className="pointer-events-none absolute box-border"
          style={{ left: box.x + gap, top: box.y + gap, width: box.w - 2 * gap, height: box.h - 2 * gap, borderWidth: BOX_BORDER_PX / scale, borderStyle: 'solid', borderColor: cursorVar[follow.boxColour] }}
        />
      )}
      {follow.line && (
        <div
          data-slot="follow-line"
          className="pointer-events-none absolute"
          style={{
            left: box.x,
            top: box.y,
            width: LINE_PX / scale,
            height: box.h,
            backgroundColor: cursorVar[follow.lineColour],
            transform: `translateX(${fraction * box.w}px)`,
            willChange: 'transform',
          }}
        />
      )}
    </>
  )
}
