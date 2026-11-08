// The "Edit piece structure" switch and its idle check (Decisions 2026-11-03), as a pure state machine: time comes in
// as a number and the page runs the clock. A minute after the last editor action the app asks "Still editing the
// piece?"; unanswered for 30 s more, the switch turns off and the status line says so.

export const IDLE_ASK_MS = 60_000
export const IDLE_OFF_MS = 30_000

export interface PieceEditingState {
  on: boolean
  lastActionMs: number | null
  askedAtMs: number | null // when "Still editing the piece?" was asked; null when it is not showing
  turnedOffIdle: boolean // the switch went off by itself; cleared by the next action
}

export type PieceEditingEvent =
  | { type: 'turn-on'; now: number }
  | { type: 'turn-off' }
  | { type: 'action'; now: number } // any edit, click, drag or key press in the editor; not scrolling or playback
  | { type: 'keep'; now: number } // Keep editing
  | { type: 'tick'; now: number }

export const initialPieceEditing: PieceEditingState = { on: false, lastActionMs: null, askedAtMs: null, turnedOffIdle: false }

export function pieceEditing(state: PieceEditingState, event: PieceEditingEvent): PieceEditingState {
  switch (event.type) {
    case 'turn-on':
      return { on: true, lastActionMs: event.now, askedAtMs: null, turnedOffIdle: false }
    case 'turn-off':
      return initialPieceEditing
    case 'action':
    case 'keep':
      if (!state.on) return state.turnedOffIdle ? { ...state, turnedOffIdle: false } : state
      return { ...state, lastActionMs: event.now, askedAtMs: null }
    case 'tick': {
      if (!state.on || state.lastActionMs === null) return state
      if (state.askedAtMs === null) {
        return event.now - state.lastActionMs >= IDLE_ASK_MS ? { ...state, askedAtMs: event.now } : state
      }
      return event.now - state.askedAtMs >= IDLE_OFF_MS ? { ...initialPieceEditing, turnedOffIdle: true } : state
    }
  }
}
