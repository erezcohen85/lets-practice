import { IDLE_ASK_MS, IDLE_OFF_MS, initialPieceEditing, pieceEditing, type PieceEditingState } from '@/domain/pieceEditing'

function run(state: PieceEditingState, ...events: Parameters<typeof pieceEditing>[1][]): PieceEditingState {
  return events.reduce(pieceEditing, state)
}

const on = run(initialPieceEditing, { type: 'turn-on', now: 0 })

describe('the Edit piece structure switch and its idle check', () => {
  it('starts off and turns on with the time of the first action', () => {
    expect(initialPieceEditing.on).toBe(false)
    expect(on).toEqual({ on: true, lastActionMs: 0, askedAtMs: null, turnedOffIdle: false })
  })

  it('asks a minute after the last action, not before', () => {
    expect(run(on, { type: 'tick', now: IDLE_ASK_MS - 1 }).askedAtMs).toBeNull()
    expect(run(on, { type: 'tick', now: IDLE_ASK_MS }).askedAtMs).toBe(IDLE_ASK_MS)
  })

  it('an action moves the question a minute on', () => {
    const acted = run(on, { type: 'action', now: 50_000 }, { type: 'tick', now: 60_000 })
    expect(acted.askedAtMs).toBeNull()
    expect(run(acted, { type: 'tick', now: 110_000 }).askedAtMs).toBe(110_000)
  })

  it('turns off when the question stays unanswered for 30 s, and says so', () => {
    const asked = run(on, { type: 'tick', now: IDLE_ASK_MS })
    expect(run(asked, { type: 'tick', now: IDLE_ASK_MS + IDLE_OFF_MS - 1 }).on).toBe(true)
    expect(run(asked, { type: 'tick', now: IDLE_ASK_MS + IDLE_OFF_MS })).toEqual({
      on: false,
      lastActionMs: null,
      askedAtMs: null,
      turnedOffIdle: true,
    })
  })

  it('Keep editing, or any action while asking, restarts the minute', () => {
    const asked = run(on, { type: 'tick', now: IDLE_ASK_MS })
    const kept = run(asked, { type: 'keep', now: 70_000 })
    expect(kept.askedAtMs).toBeNull()
    expect(run(kept, { type: 'tick', now: 129_999 }).askedAtMs).toBeNull()
    expect(run(kept, { type: 'tick', now: 130_000 }).askedAtMs).toBe(130_000)
    expect(run(asked, { type: 'action', now: 70_000 })).toEqual(kept)
  })

  it('turning off clears everything, and off ignores ticks and actions', () => {
    const off = run(on, { type: 'tick', now: IDLE_ASK_MS }, { type: 'turn-off' })
    expect(off).toEqual(initialPieceEditing)
    expect(run(off, { type: 'tick', now: 999_999 }, { type: 'action', now: 999_999 })).toEqual(initialPieceEditing)
  })

  it('the idle note clears with the next action or when turned on again', () => {
    const idle = run(on, { type: 'tick', now: IDLE_ASK_MS }, { type: 'tick', now: IDLE_ASK_MS + IDLE_OFF_MS })
    expect(run(idle, { type: 'action', now: 200_000 }).turnedOffIdle).toBe(false)
    expect(run(idle, { type: 'turn-on', now: 200_000 }).turnedOffIdle).toBe(false)
  })
})
