import { useEffect, useRef } from 'react'
import { type EditMode } from '@/lib/useEditorDoc'

export interface EditorKeyHandlers {
  onMode(mode: EditMode): void
  onUndo(): void
  onRedo(): void
}

const MODE_KEYS: Record<string, EditMode> = { v: 'move', b: 'add', x: 'delete' }

/** A key pressed in a field belongs to the field (typing, or the field's own undo). */
export function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.matches('input, textarea, select') || target.isContentEditable) return true
  // jsdom has no isContentEditable: read the attribute too.
  const editable = target.closest('[contenteditable]')
  return editable !== null && editable.getAttribute('contenteditable') !== 'false'
}

/**
 * The Edit sheet's keys: V / B / X pick the mode; Cmd+Z / Ctrl+Z undo; Shift+Cmd+Z, Ctrl+Shift+Z and Ctrl+Y redo.
 * Nothing fires while a text field has focus. Cmd, Ctrl or Alt held leaves V / B / X to the browser.
 */
export function useEditorKeys(handlers: EditorKeyHandlers): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || inTextField(event.target)) return
      const key = event.key.toLowerCase()
      const { onMode, onUndo, onRedo } = latest.current
      if (event.metaKey || event.ctrlKey) {
        if (event.altKey) return
        if (key === 'z') (event.shiftKey ? onRedo : onUndo)()
        else if (key === 'y' && event.ctrlKey && !event.metaKey) onRedo()
        else return
        event.preventDefault()
        return
      }
      const mode = event.altKey ? undefined : MODE_KEYS[key]
      if (mode === undefined) return
      onMode(mode)
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
