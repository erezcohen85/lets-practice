import { useSyncExternalStore, type RefObject } from 'react'
import { type FollowClock } from '@/components/practice/followClock'
import { useFollowScroll } from '@/components/practice/useFollowScroll'
import { type ScrollRequest } from '@/components/score/ScoreView'
import { followTarget } from '@/domain/practice'
import { slotIndexAt, type SlotTiming } from '@/domain/tempo'
import { type PageLayer } from '@/domain/types'
import { type FollowSettings } from '@/lib/dataClient'

/**
 * The Editor's version of Practice's follow scroll: the score keeps the bar being heard in view, but only while the
 * editor plays, so that a paused playhead (or a seek made to edit) never moves the score under the user's hands. The
 * playhead's time comes from the clock, read as a bar number, so the page redraws when the music reaches another bar
 * and not on every frame.
 */
export function useEditorFollowScroll({
  clock,
  timeline,
  page,
  scroll,
  playing,
  containerRef,
}: {
  clock: FollowClock
  timeline: SlotTiming[]
  page: PageLayer
  scroll: FollowSettings['scroll']
  playing: boolean
  /** The element around the score. */
  containerRef: RefObject<HTMLElement | null>
}): ScrollRequest | null {
  const index = useSyncExternalStore(clock.subscribe, () => slotIndexAt(timeline, clock.get()))
  // The start of the bar: it has the same page and line as any time in it.
  const target = playing && index !== -1 ? followTarget(timeline, page, timeline[index].startSec) : null
  return useFollowScroll({ scroll, target, barIndex: index, playing, containerRef })
}
