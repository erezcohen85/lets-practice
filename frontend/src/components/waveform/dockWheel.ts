/** The sign of deltaY that zooms the waveform in. 1: the direction that scrolls a web page down (Erez: down = in). Set to -1 to flip. */
export const WHEEL_ZOOM_IN_SIGN: 1 | -1 = 1
/** One zoom step per this many pixels of vertical wheel, so the many small deltas of a Magic Mouse do not race through the steps. */
export const WHEEL_STEP_PX = 40
/** A trackpad pinch sends small deltas (about 1 to 10 an event), so it takes a step sooner. */
export const PINCH_STEP_PX = 10
const LINE_PX = 16

export interface WheelInput { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean; ctrlKey: boolean }
/** A zoom `amount` in pixels is positive to zoom in. */
export type WheelAction = { kind: 'pan'; px: number } | { kind: 'zoom'; amount: number; pinch: boolean }

/**
 * What a wheel event asks of the waveform, in pixels: pan (sideways, or Shift with a vertical wheel) or zoom (vertical,
 * or Ctrl, which is a trackpad pinch). The larger of the two deltas decides, so a diagonal swipe does one thing.
 * `pageWidth` is what a delta counted in pages is worth. `zoomInSign` is the sign of a plain vertical delta that zooms
 * in; a pinch ignores it and keeps the browser's own convention: fingers spread apart is deltaY below 0, which zooms in.
 */
export function classifyWheel(event: WheelInput, pageWidth: number, zoomInSign: 1 | -1 = WHEEL_ZOOM_IN_SIGN): WheelAction | null {
  const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? pageWidth : 1
  const dx = event.deltaX * unit
  const dy = event.deltaY * unit
  if (event.ctrlKey) return dy === 0 ? null : { kind: 'zoom', amount: -dy, pinch: true }
  if (event.shiftKey) {
    const px = Math.abs(dy) >= Math.abs(dx) ? dy : dx
    return px === 0 ? null : { kind: 'pan', px }
  }
  if (dx === 0 && dy === 0) return null
  return Math.abs(dx) > Math.abs(dy) ? { kind: 'pan', px: dx } : { kind: 'zoom', amount: dy * zoomInSign, pinch: false }
}

/** Adds a zoom amount to what was gathered and takes the whole steps of `stepPx` out of it (positive: in). A change of direction drops what was gathered. */
export function accumulateZoom(acc: number, amount: number, stepPx: number): { acc: number; steps: number } {
  const total = acc !== 0 && Math.sign(acc) !== Math.sign(amount) ? amount : acc + amount
  const steps = Math.trunc(total / stepPx) || 0
  return { acc: total - steps * stepPx, steps }
}
