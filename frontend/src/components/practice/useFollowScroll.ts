import { useEffect, useRef, useState, type RefObject } from 'react'
import { type FollowTarget } from '@/domain/practice'
import { type ScrollRequest } from '@/components/score/ScoreView'
import { type FollowSettings } from '@/lib/dataClient'

/** Where the playing line is kept, as a share of the column's height from its top: the line and the lines after it stay in the top third. */
export const LINE_AT = 0.25

/**
 * The scroll that keeps the score on the music: one request for ScoreView each time the playing line changes (scroll by
 * line) or the cursor enters another page (page turns), and none while a bar of the same line plays on (a new play asks again). A scroll made by
 * the user (wheel, touch, a press on the scrollbar) stops following; it resumes, with a request for where the cursor is
 * now, at the next bar change or the next play. ScoreView's own scrolls are not the user's: the user's are read from the
 * input events, not from the scroll.
 */
export function useFollowScroll({
  scroll,
  target,
  barIndex,
  playing,
  containerRef,
}: {
  scroll: FollowSettings['scroll']
  target: FollowTarget | null
  /** The play-order position of the bar being played; -1 outside the timeline. */
  barIndex: number
  playing: boolean
  /** The element around the score. */
  containerRef: RefObject<HTMLElement | null>
}): ScrollRequest | null {
  const [request, setRequest] = useState<ScrollRequest | null>(null)
  const manualRef = useRef(false)
  // What the last request was for, and the bar and play state it was made in.
  const placedRef = useRef<string | null>(null)
  const seenRef = useRef({ barIndex, playing })

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const stop = () => {
      manualRef.current = true
      placedRef.current = null
    }
    // A press on the scrollbar lands on the scroller itself; a press on a page is a tap on the score.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches('[data-slot=score-scroll]')) stop()
    }
    container.addEventListener('wheel', stop, { passive: true })
    container.addEventListener('touchmove', stop, { passive: true })
    container.addEventListener('pointerdown', onPointerDown)
    return () => {
      container.removeEventListener('wheel', stop)
      container.removeEventListener('touchmove', stop)
      container.removeEventListener('pointerdown', onPointerDown)
    }
  }, [containerRef])

  const key = target === null ? null : scroll === 'page' ? `${target.pageIndex}` : `${target.pageIndex}:${target.lineTop}`
  const pageIndex = target?.pageIndex
  const lineTop = target?.lineTop
  useEffect(() => {
    const seen = seenRef.current
    const started = playing && !seen.playing
    if (seen.barIndex !== barIndex || started) manualRef.current = false
    // Playing again asks again, even for the line the last request was for: the score may have been moved since.
    if (started) placedRef.current = null
    seenRef.current = { barIndex, playing }
    if (manualRef.current || key === null || pageIndex === undefined || lineTop === undefined || key === placedRef.current) return
    placedRef.current = key
    setRequest(scroll === 'page' ? { pageIndex, y: 0, at: 0 } : { pageIndex, y: lineTop, at: LINE_AT })
  }, [key, pageIndex, lineTop, scroll, barIndex, playing])

  return request
}
