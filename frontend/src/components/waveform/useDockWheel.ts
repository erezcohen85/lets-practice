import { type RefObject, useEffect, useRef } from 'react'
import { accumulateZoom, classifyWheel, PINCH_STEP_PX, WHEEL_STEP_PX } from '@/components/waveform/dockWheel'
import { type DockView } from '@/components/waveform/useDockView'

interface DockWheel {
  view: DockView
  width: number
  scrollBy(sec: number): void
  /** 1 zooms in and -1 out, around the point `fraction` (0 to 1) across the window. */
  zoomAt(direction: 1 | -1, fraction: number): void
  /** The window was moved by hand. */
  onManual(): void
}

/**
 * The wheel over the stage: sideways pans, vertical zooms around the pointer (see `classifyWheel`). The listener is
 * registered by hand because React's wheel handlers are passive and could not keep the page from scrolling.
 */
export function useDockWheel(stageRef: RefObject<HTMLElement | null>, wheel: DockWheel) {
  const latest = useRef(wheel)
  useEffect(() => {
    latest.current = wheel
  })
  // The scroll wheel and the pinch count in different units, so each gathers on its own.
  const gathered = useRef({ wheel: 0, pinch: 0 })

  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const onWheel = (event: WheelEvent) => {
      const { view, width, scrollBy, zoomAt, onManual } = latest.current
      const action = classifyWheel(event, width)
      if (action === null) return
      event.preventDefault()
      onManual()
      if (action.kind === 'pan') {
        scrollBy((action.px * view.spanSec) / width)
        return
      }
      const key = action.pinch ? 'pinch' : 'wheel'
      const { acc, steps } = accumulateZoom(gathered.current[key], action.amount, action.pinch ? PINCH_STEP_PX : WHEEL_STEP_PX)
      gathered.current[key] = acc
      if (steps === 0) return
      const fraction = Math.min(1, Math.max(0, (event.clientX - stage.getBoundingClientRect().left) / width))
      for (let i = 0; i < Math.abs(steps); i++) zoomAt(steps > 0 ? 1 : -1, fraction)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [stageRef])
}
