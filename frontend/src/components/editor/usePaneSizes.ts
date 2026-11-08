import { useEffect, useState } from 'react'

/** The Review Queue's width, in px. */
export const QUEUE_WIDTH = { default: 360, min: 280, maxShare: 0.5 }
/** The waveform dock's height, in px: the 88 px play ring row (the locator controls wrap under it on a narrow window) and a waveform of about 100 px at the least. */
export const DOCK_HEIGHT = { default: 262, min: 236, maxShare: 0.6 }

export interface PaneSize {
  value: number
  min: number
  max: number
  default: number
  set(value: number): void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * The sizes of the two resizable regions of the Editor, for this visit only: the Review Queue's width and the dock's
 * height. They are view state (never saved, never in the undo history). The upper limit follows the window, so a size
 * that no longer fits after the window shrinks is shown at the limit.
 */
export function usePaneSizes(): { queue: PaneSize; dock: PaneSize } {
  const [queueWidth, setQueueWidth] = useState(QUEUE_WIDTH.default)
  const [dockHeight, setDockHeight] = useState(DOCK_HEIGHT.default)
  const [viewport, setWindow] = useState({ width: window.innerWidth, height: window.innerHeight })

  useEffect(() => {
    const onResize = () => setWindow({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const queueMax = Math.max(QUEUE_WIDTH.min, Math.floor(viewport.width * QUEUE_WIDTH.maxShare))
  const dockMax = Math.max(DOCK_HEIGHT.min, Math.floor(viewport.height * DOCK_HEIGHT.maxShare))
  return {
    queue: { value: clamp(queueWidth, QUEUE_WIDTH.min, queueMax), min: QUEUE_WIDTH.min, max: queueMax, default: QUEUE_WIDTH.default, set: setQueueWidth },
    dock: { value: clamp(dockHeight, DOCK_HEIGHT.min, dockMax), min: DOCK_HEIGHT.min, max: dockMax, default: DOCK_HEIGHT.default, set: setDockHeight },
  }
}
