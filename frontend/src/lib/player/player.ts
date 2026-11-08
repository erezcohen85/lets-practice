export type PlayerEvent = 'play' | 'pause' | 'ended' | 'seek' | 'rate' | 'loaded' | 'error'

/** One recording, played at recording time; loop, cursor and locators always use getTime(), never wall clock. */
export interface Player {
  /** Resolves when it can play; rejects with Error('could not load the recording'). */
  load(url: string): Promise<void>
  play(): Promise<void>
  pause(): void
  /** Clamped to 0..duration. */
  seek(timeSec: number): void
  getTime(): number
  /** Null until the recording is loaded. */
  getDuration(): number | null
  isPlaying(): boolean
  /** Any speed inside getRateRange(); throws a RangeError for another. */
  setRate(rate: number): void
  /** The speeds it plays: from `min` to `max` in steps of `step`. */
  getRateRange(): { readonly min: number; readonly max: number; readonly step: number }
  /** The music volume, 0..1 (clamped); a new player is at 1. */
  setVolume(volume: number): void
  getVolume(): number
  /**
   * A multiplier 0..1 on the music volume, for the count-in fade; a new player is at 1. It never makes the music louder
   * than the volume. A value that is not a number is read as 1, so a bug in a fade cannot leave the music silent.
   */
  setFade(level: number): void
  getFade(): number
  /**
   * Call from a user gesture (a tap on play). A player that needs setting up for volume control, because the device
   * ignores the element's volume (iPad Safari), does it here; a second call changes nothing.
   */
  prepare(): void
  /** Returns an unsubscribe function. */
  onChange(listener: (event: PlayerEvent) => void): () => void
  destroy(): void
}

export const LOAD_ERROR_MESSAGE = 'could not load the recording'
