/** The time the cursor is at, in recording seconds, shared so that the gliding line redraws every frame without the page doing so. */
export interface FollowClock {
  get(): number
  set(timeSec: number): void
  subscribe(listener: () => void): () => void
}

export function createFollowClock(initialSec: number): FollowClock {
  let value = initialSec
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(timeSec) {
      if (timeSec === value) return
      value = timeSec
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
