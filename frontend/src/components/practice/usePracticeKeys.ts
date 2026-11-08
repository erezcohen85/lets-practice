import { useEffect, useRef } from 'react'
import { type PracticeControls } from '@/lib/usePractice'
import { strings } from '@/strings'

const keys: Record<keyof typeof strings.practice.keyMap, readonly string[]> = strings.practice.keyMap

/** A key pressed in a field belongs to the field (typing, moving the caret). */
function inTextField(target: HTMLElement): boolean {
  if (target.matches('input, textarea, select') || target.isContentEditable) return true
  // jsdom has no isContentEditable: read the attribute too.
  const editable = target.closest('[contenteditable]')
  return editable !== null && editable.getAttribute('contenteditable') !== 'false'
}

// Controls that use the arrow keys themselves: a slider (the loop handles, the overview), a menu, a radio group.
const OWN_ARROWS = '[role=slider], [role=menu], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=radio], [role=listbox], [role=option], [role=tab]'
// Controls Space activates.
const OWN_SPACE = 'button, a[href], summary, [role=button], [role=switch], [role=checkbox]'

/**
 * Hands free practice: Space plays or pauses, Left arrow and PageUp restart the loop, Right arrow and PageDown play the
 * next one (a Bluetooth page-turn pedal sends PageUp and PageDown). Nothing fires while focus is in a text field, a
 * menu or a slider, whose keys are their own. Cmd, Ctrl and Alt leave a key to the browser, and so does a key held down
 * (a pedal that repeats must not toggle twice).
 *
 * Space and a focused button: a button the keyboard focused keeps Space, which presses it (keyboard access). A button
 * a pointer focused (the last thing done was a tap or a click, not a key) lets go of the focus and Space plays, so the
 * pedal works after a tap on the toolbar; the button never sees that key. A pedal's own keys do not count as the keyboard.
 */
export function usePracticeKeys(controls: Pick<PracticeControls, 'playPause' | 'restartLoop' | 'nextLoop'>): void {
  const latest = useRef(controls)
  useEffect(() => {
    latest.current = controls
  })

  useEffect(() => {
    let lastInput: 'pointer' | 'keyboard' = 'keyboard'
    const onPointerDown = () => {
      lastInput = 'pointer'
    }
    // First, before the controls: a pointer-focused button gives its Space to play / pause (some controls, a switch,
    // cancel Space themselves, so this cannot wait for the key to come up through them).
    function onKeyDownFirst(event: KeyboardEvent) {
      if (!keys.playPause.includes(event.key) && !keys.restartLoop.includes(event.key) && !keys.nextLoop.includes(event.key)) {
        lastInput = 'keyboard'
        return
      }
      const target = event.target instanceof HTMLElement ? event.target : null
      if (!keys.playPause.includes(event.key) || lastInput !== 'pointer' || target === null) return
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (inTextField(target) || target.closest(OWN_ARROWS) !== null || target.closest(OWN_SPACE) === null) return
      // Focus goes back to the page, so the release of Space does not press the button either.
      target.blur()
      event.stopPropagation()
      event.preventDefault()
      latest.current.playPause()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const { playPause, restartLoop, nextLoop } = latest.current
      const action = keys.playPause.includes(event.key) ? playPause : keys.restartLoop.includes(event.key) ? restartLoop : keys.nextLoop.includes(event.key) ? nextLoop : null
      if (action === null) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target !== null) {
        if (inTextField(target) || target.closest(OWN_ARROWS) !== null) return
        if (action === playPause && target.closest(OWN_SPACE) !== null) return
      }
      event.preventDefault()
      action()
    }
    // Captured, so a control that stops the press still counts.
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDownFirst, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDownFirst, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
