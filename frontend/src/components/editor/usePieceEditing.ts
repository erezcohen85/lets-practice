import { useCallback, useEffect, useReducer, useState } from 'react'
import { initialPieceEditing, pieceEditing } from '@/domain/pieceEditing'

/** How often the idle check looks at the clock while the switch is on. */
const TICK_MS = 5000

/**
 * The "Edit piece structure" switch of this editor visit (view state, never saved, not an undo step): off on every
 * visit, so leaving the editor turns it off. The page feeds it the editor's actions; the clock runs only while it is on.
 */
export function usePieceEditing() {
  const [state, dispatch] = useReducer(pieceEditing, initialPieceEditing)
  // The warning shown before the switch turns on, asked for by the Edit sheet or by Structure's Piece section.
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!state.on) return
    const id = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), TICK_MS)
    return () => clearInterval(id)
  }, [state.on])
  return {
    state,
    asking,
    requestOn: useCallback(() => setAsking(true), []),
    cancelRequest: useCallback(() => setAsking(false), []),
    turnOn: useCallback(() => {
      setAsking(false)
      dispatch({ type: 'turn-on', now: Date.now() })
    }, []),
    turnOff: useCallback(() => dispatch({ type: 'turn-off' }), []),
    action: useCallback(() => dispatch({ type: 'action', now: Date.now() }), []),
    keep: useCallback(() => dispatch({ type: 'keep', now: Date.now() }), []),
  }
}

export type PieceEditingApi = ReturnType<typeof usePieceEditing>
