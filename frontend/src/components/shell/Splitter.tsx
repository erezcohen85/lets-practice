import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'

const STEP = 16
const BIG_STEP = 64

export interface SplitterProps {
  /** The line: 'vertical' stands between two columns and sizes a width, 'horizontal' lies between two rows and sizes a height. */
  orientation: 'vertical' | 'horizontal'
  label: string
  /** The size of the pane after the line (the one at the end, or the bottom), in px. Dragging the line toward the start makes it larger. */
  value: number
  min: number
  max: number
  defaultValue: number
  onChange(value: number): void
  className?: string
}

/**
 * A line between two panes that the user drags (pointer) or moves with the arrow keys; a double click puts it back.
 * It holds no size itself: the page owns `value` and applies it to the layout.
 */
export function Splitter({ orientation, label, value, min, max, defaultValue, onChange, className }: SplitterProps) {
  const vertical = orientation === 'vertical'
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ from: number; start: number } | null>(null)
  const clamp = (size: number) => Math.min(max, Math.max(min, size))
  const position = (event: PointerEvent) => (vertical ? event.clientX : event.clientY)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { from: position(event), start: value }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return
    // In a right-to-left page the pane after the line is on the left, so the pull works the other way round.
    const flip = vertical && getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1
    onChange(clamp(drag.current.start - flip * (position(event) - drag.current.from)))
  }
  const onPointerUp = () => {
    drag.current = null
    setDragging(false)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP
    const grow = vertical ? 'ArrowLeft' : 'ArrowUp'
    const shrink = vertical ? 'ArrowRight' : 'ArrowDown'
    if (event.key === grow) onChange(clamp(value + step))
    else if (event.key === shrink) onChange(clamp(value - step))
    else if (event.key === 'Home') onChange(min)
    else if (event.key === 'End') onChange(max)
    else return
    event.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-slot="splitter"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onDoubleClick={() => onChange(clamp(defaultValue))}
      onKeyDown={onKeyDown}
      className={cn(
        // A thin line with a wider invisible hit area (8 px) around it.
        "relative z-10 shrink-0 touch-none bg-border outline-none select-none after:absolute after:content-[''] hover:bg-primary-strong focus-visible:bg-primary-strong",
        vertical ? 'w-px cursor-col-resize after:-inset-x-1 after:inset-y-0' : 'h-px cursor-row-resize after:-inset-y-1 after:inset-x-0',
        dragging && 'bg-primary-strong',
        className,
      )}
    />
  )
}
