import { SPEED_RANGE } from '@/domain/tempo'
import { LOAD_ERROR_MESSAGE, type Player, type PlayerEvent } from '@/lib/player/player'

/** A Player for tests: time moves only by advance(); load resolves at once, or rejects for a URL that starts 'fail:'. */
export interface FakePlayer extends Player {
  /** Lets `seconds` of wall clock pass: while playing, recording time moves by seconds × the rate. */
  advance(seconds: number): void
  loadedUrl: string | null
  /** The rate the last setRate gave. */
  getRate(): number
  /** What would reach the ears: the music volume times the fade. */
  readonly level: number
}

export function createFakePlayer(durationSec = 60): FakePlayer {
  const listeners = new Set<(event: PlayerEvent) => void>()
  let loadedUrl: string | null = null
  let time = 0
  let rate = 1
  let playing = false
  let volume = 1
  let fade = 1

  function emit(event: PlayerEvent): void {
    for (const listener of [...listeners]) listener(event)
  }

  function stop(event: 'pause' | 'ended'): void {
    playing = false
    emit(event)
  }

  const player: FakePlayer = {
    get loadedUrl() {
      return loadedUrl
    },

    get level() {
      return volume * fade
    },

    async load(url) {
      if (url.startsWith('fail:')) {
        emit('error')
        throw new Error(LOAD_ERROR_MESSAGE)
      }
      loadedUrl = url
      time = 0
      playing = false
      emit('loaded')
    },

    async play() {
      if (loadedUrl === null) throw new Error('no recording loaded')
      if (playing) return
      if (time >= durationSec) time = 0
      playing = true
      emit('play')
    },

    pause() {
      if (playing) stop('pause')
    },

    seek(timeSec) {
      time = Math.max(0, Math.min(timeSec, loadedUrl === null ? Infinity : durationSec))
      emit('seek')
    },

    getTime() {
      return time
    },

    getDuration() {
      return loadedUrl === null ? null : durationSec
    },

    isPlaying() {
      return playing
    },

    setRate(next) {
      if (!(next >= SPEED_RANGE.min && next <= SPEED_RANGE.max)) throw new RangeError(`speed ${next} is not from ${SPEED_RANGE.min} to ${SPEED_RANGE.max}`)
      rate = next
      emit('rate')
    },

    getRate() {
      return rate
    },

    getRateRange() {
      return SPEED_RANGE
    },

    setVolume(next) {
      volume = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 0
    },

    getVolume() {
      return volume
    },

    setFade(next) {
      fade = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 1
    },

    getFade() {
      return fade
    },

    prepare() {},

    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    destroy() {
      listeners.clear()
      playing = false
    },

    advance(seconds) {
      if (!playing) return
      time = Math.min(durationSec, time + seconds * rate)
      if (time >= durationSec) {
        stop('pause')
        emit('ended')
      }
    },
  }
  return player
}
