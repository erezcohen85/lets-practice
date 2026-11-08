import { useEffect, useRef } from 'react'
import { type BarStep } from '@/domain/barNavigation'
import { inTextField } from './useEditorKeys'

const STEPS: Record<string, BarStep> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/**
 * The arrow keys on the score: ← → the previous and next bar, ↑ ↓ the bar of the line above and below. A key a text
 * field, the waveform or another control already took (it prevented the default) is left alone, and so is one pressed
 * with Cmd, Ctrl, Alt or Shift.
 */
export function useBarArrowKeys(onStep: (step: BarStep) => void): void {
  const latest = useRef(onStep)
  useEffect(() => {
    latest.current = onStep
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const step = STEPS[event.key]
      if (step === undefined || event.defaultPrevented || inTextField(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      event.preventDefault() // the arrows move the selection, not the page
      latest.current(step)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
