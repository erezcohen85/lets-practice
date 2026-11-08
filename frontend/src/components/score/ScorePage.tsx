import { type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react'
import { type BarBox, type BarNumber } from '@/domain/types'
import { type PageImage } from '@/lib/dataClient'
import { strings } from '@/strings'
import { BarOverlay, type BarState } from './BarOverlay'

export interface ScorePointerEvent {
  type: 'down' | 'move' | 'up' | 'leave'
  pageIndex: number
  x: number
  y: number
  shiftKey: boolean
}

/** One page image at `scale`, its bar boxes on top, and a layer in image pixels for whatever the Edit sheet draws. */
export function ScorePage({
  image,
  total,
  scale,
  boxes,
  barStates,
  barTags,
  selectedBar,
  showBarNumbers,
  onPointer,
  overlay,
  pageRef,
}: {
  image: PageImage
  total: number
  scale: number
  boxes: readonly BarBox[]
  barStates: ReadonlyMap<BarNumber, BarState>
  barTags?: ReadonlyMap<BarNumber, string>
  selectedBar?: BarNumber | null
  showBarNumbers?: boolean
  onPointer?(event: ScorePointerEvent): void
  overlay?: ReactNode
  pageRef: Ref<HTMLDivElement>
}) {
  function report(type: ScorePointerEvent['type']) {
    return (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!onPointer) return
      // The drawn rectangle tells the true scale (the browser may round the width); without one, use the given scale.
      const rect = event.currentTarget.getBoundingClientRect()
      const ratio = rect.width > 0 ? image.width / rect.width : 1 / scale
      onPointer({
        type,
        pageIndex: image.pageIndex,
        x: (event.clientX - rect.left) * ratio,
        y: (event.clientY - rect.top) * ratio,
        shiftKey: event.shiftKey,
      })
    }
  }

  return (
    <div
      ref={pageRef}
      data-slot="score-page"
      data-page-index={image.pageIndex}
      className="relative shrink-0 bg-paper shadow-lg"
      style={{ width: image.width * scale, height: image.height * scale }}
      onPointerDown={report('down')}
      onPointerMove={report('move')}
      onPointerUp={report('up')}
      onPointerLeave={report('leave')}
    >
      <img
        src={image.url}
        alt={strings.score.pageAlt(image.pageIndex + 1, total)}
        draggable={false}
        className="block size-full select-none"
      />
      <BarOverlay boxes={boxes} barStates={barStates} barTags={barTags} selectedBar={selectedBar} scale={scale} showNumbers={showBarNumbers} />
      {overlay != null && (
        <div
          data-slot="score-overlay"
          className="pointer-events-none absolute"
          style={{ left: 0, top: 0, width: image.width, height: image.height, transform: `scale(${scale})`, transformOrigin: '0 0' }}
        >
          {overlay}
        </div>
      )}
    </div>
  )
}
