import { useSyncExternalStore } from 'react'
import { Check } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent } from 'react'
import { type LoopRange } from '@/domain/practice'
import { barsInRange, positionNearTime, type RangeEdge } from '@/domain/rangeEdges'
import { type SlotTiming } from '@/domain/tempo'
import { type BarBox, type BarNumber } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'
import { loopClass } from './loopColour'
import { type RangeEdges } from './useRangeEdges'
import { type FollowClock } from './followClock'
import { type PassToggle } from './usePicking'

// The handles and the toggle are drawn in image pixels inside a scaled layer: sizes are given in screen pixels divided
// by the scale, so they stay the size of a finger at every zoom.
const HANDLE_HIT_PX = 44
const HANDLE_BAR_PX = 8

// The overlay does not take the pointer; what is drawn here that does must not let the press through to the page under
// it, or a handle or a button would also pick the bar behind it.
const stopPointer = {
  onPointerDown: (event: ReactPointerEvent) => event.stopPropagation(),
  onPointerUp: (event: ReactPointerEvent) => event.stopPropagation(),
  onPointerMove: (event: ReactPointerEvent) => event.stopPropagation(),
}

export interface RangeLayerProps {
  pageIndex: number
  scale: number
  /** Every bar box of the part. */
  bars: readonly BarBox[]
  timeline: SlotTiming[]
  range: LoopRange | null
  /** The bar a long press started the range at, until the last bar is tapped. */
  pending: BarNumber | null
  /** The "1st time / 2nd time" control a tap on a repeated bar opened. */
  toggle: PassToggle | null
  /** The time the cursor is at, for the pass the toggle shows pressed. */
  clock: FollowClock
  edges: RangeEdges
  /** The bars of the range are tinted (Settings: show the loop on the score); off keeps the handles at its ends. */
  showTint?: boolean
  onChoose(pass: number): void
}

/** On one page of the score: the loop range tinted with the loop colour (unless Settings hides the tint), a drag handle at each end, the first bar of a range being picked, and the "1st time / 2nd time" toggle. */
export function RangeLayer({ pageIndex, scale, bars, timeline, range, pending, toggle, clock, edges, showTint = true, onChoose }: RangeLayerProps) {
  const here = bars.filter((box) => box.pageIndex === pageIndex)
  const inRange = range === null ? null : barsInRange(timeline, range)
  const boxOf = (bar: BarNumber) => bars.find((box) => box.bar === bar)
  const startBox = range === null ? undefined : boxOf(timeline[range.startPosition].slot.bar)
  const endBox = range === null ? undefined : boxOf(timeline[range.endPosition].slot.bar)
  const toggleBox = toggle === null ? undefined : boxOf(toggle.bar)

  return (
    <>
      {here.map((box) =>
        showTint && inRange?.has(box.bar) === true ? (
          <div key={box.bar} data-slot="range-tint" data-bar={box.bar} className={cn('absolute', loopClass.tint)} style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
        ) : null,
      )}
      {here.map((box) =>
        box.bar === pending ? (
          <div key={box.bar} data-slot="range-pending" data-bar={box.bar} className={cn('absolute box-border', loopClass.tint)} style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderWidth: 2 / scale, borderStyle: 'solid', borderColor: 'var(--lp-loop-user, var(--lp-loop))' }} />
        ) : null,
      )}
      {startBox?.pageIndex === pageIndex && <EdgeHandle edge="start" box={startBox} scale={scale} edges={edges} />}
      {endBox?.pageIndex === pageIndex && <EdgeHandle edge="end" box={endBox} scale={scale} edges={edges} />}
      {toggle !== null && toggleBox?.pageIndex === pageIndex && <PassToggleMenu toggle={toggle} box={toggleBox} scale={scale} timeline={timeline} clock={clock} onChoose={onChoose} />}
    </>
  )
}

function EdgeHandle({ edge, box, scale, edges }: { edge: RangeEdge; box: BarBox; scale: number; edges: RangeEdges }) {
  const names = useBarNames()
  const hit = HANDLE_HIT_PX / scale
  const edgeX = edge === 'start' ? box.x : box.x + box.w
  const label = edge === 'start' ? strings.practice.loopStart : strings.practice.loopEnd
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuenow={box.bar}
      aria-valuetext={strings.practice.bar(names.label(box.bar))}
      data-slot="range-handle"
      data-edge={edge}
      className="pointer-events-auto absolute flex cursor-ew-resize touch-none items-stretch justify-center outline-none focus-visible:[&>span]:ring-4 focus-visible:[&>span]:ring-ring"
      style={{ left: edgeX - hit / 2, top: box.y, width: hit, height: Math.max(box.h, hit) }}
      onPointerDown={(event) => {
        event.stopPropagation()
        edges.startDrag(edge)
      }}
      onPointerUp={stopPointer.onPointerUp}
      onPointerMove={stopPointer.onPointerMove}
      onKeyDown={(event) => {
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
        if (delta === 0) return
        event.preventDefault()
        edges.nudge(edge, delta)
      }}
    >
      <span aria-hidden="true" className={cn('rounded-full', loopClass.handle)} style={{ width: HANDLE_BAR_PX / scale }} />
    </div>
  )
}

/**
 * "1st time / 2nd time" at the foot of a bar played more than once: a toggle with the pass the play line is in pressed,
 * marked by a tick as well as by its fill so that colour is not the only sign. It never takes the focus, so Space still
 * plays after a tap.
 */
function PassToggleMenu({
  toggle,
  box,
  scale,
  timeline,
  clock,
  onChoose,
}: {
  toggle: PassToggle
  box: BarBox
  scale: number
  timeline: SlotTiming[]
  clock: FollowClock
  onChoose(pass: number): void
}) {
  const names = useBarNames()
  const timeSec = useSyncExternalStore(clock.subscribe, clock.get)
  const near = positionNearTime(timeline, toggle.bar, timeSec, { timedOnly: true })
  const current = near === null ? -1 : timeline[near].slot.passIndex
  return (
    <div
      role="group"
      aria-label={strings.practice.passQuestion(names.label(toggle.bar))}
      data-slot="pass-choice"
      className="pointer-events-auto absolute z-10 flex gap-1 rounded-card border border-border bg-surface p-1 shadow-lg"
      // Drawn at the foot of the bar at the size of the screen, not of the page.
      style={{ left: box.x, top: box.y + box.h, transform: `scale(${1 / scale})`, transformOrigin: '0 0' }}
      {...stopPointer}
    >
      {toggle.passes.map(({ pass, timed }) => {
        const pressed = pass === current
        return (
          <button
            key={pass}
            type="button"
            aria-pressed={pressed}
            // No locator, no time in the recording: kept in the list so the state is honest, but it goes nowhere.
            disabled={!timed}
            title={timed ? undefined : strings.practice.passNoTime}
            // A press on a button would move the focus onto it; the page keeps it.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(pass)}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-[15px] font-medium whitespace-nowrap text-text outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-surface-2 aria-pressed:font-semibold aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-text disabled:cursor-not-allowed disabled:border disabled:border-dashed disabled:border-text-soft disabled:text-text-soft disabled:opacity-60 disabled:hover:bg-transparent"
          >
            {pressed && <Check aria-hidden="true" className="size-4" />}
            {strings.practice.passChoice(pass + 1)}
          </button>
        )
      })}
    </div>
  )
}
