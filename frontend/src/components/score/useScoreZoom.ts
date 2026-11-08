import { useCallback, useState } from 'react'

/** The zoom steps of the score in percent; 100 fits the width of the score column. */
export const ZOOM_STEPS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200] as const

const FIT_INDEX = ZOOM_STEPS.indexOf(100)

/** The zoom of the score: a step from 50 to 200 %. View state, never recorded in the history. */
export function useScoreZoom() {
  const [index, setIndex] = useState(FIT_INDEX)
  const zoomIn = useCallback(() => setIndex((at) => Math.min(ZOOM_STEPS.length - 1, at + 1)), [])
  const zoomOut = useCallback(() => setIndex((at) => Math.max(0, at - 1)), [])
  const reset = useCallback(() => setIndex(FIT_INDEX), [])
  const percent = ZOOM_STEPS[index]
  return { zoom: percent / 100, zoomIn, zoomOut, reset, percent }
}

// Inputs that do not take typed text, so + and - still zoom while one has focus.
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'color', 'range'])

export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type)
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  const editable = target.getAttribute('contenteditable')
  return target.isContentEditable === true || (editable !== null && editable !== 'false')
}

/**
 * What a key press asks of the score zoom: 1 for + (or =), -1 for - (or the minus sign), 0 for anything else. Keys with
 * Ctrl, Cmd or Alt are the browser's own zoom, and typing in a text field is never taken. Shift + / - is the waveform's
 * zoom (the dock), except on the numpad, where + and - have no Shift. The editor page decides where the key listener
 * lives and calls this from it.
 */
export function zoomKeyDirection(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'> & { shiftKey?: boolean; code?: string },
): -1 | 0 | 1 {
  if (event.ctrlKey || event.metaKey || event.altKey) return 0
  if (event.shiftKey === true && event.code !== 'NumpadAdd' && event.code !== 'NumpadSubtract') return 0
  if (isTextField(event.target)) return 0
  if (event.key === '+' || event.key === '=') return 1
  if (event.key === '-' || event.key === '−') return -1
  return 0
}
