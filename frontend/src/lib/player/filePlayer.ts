import { SPEED_RANGE } from '@/domain/tempo'
import { LOAD_ERROR_MESSAGE, type Player, type PlayerEvent } from '@/lib/player/player'

// The element's own events, and the player events they become. 'loadedmetadata' is when the duration is known.
const ELEMENT_EVENTS: Record<string, PlayerEvent> = {
  play: 'play',
  pause: 'pause',
  ended: 'ended',
  seeked: 'seek',
  ratechange: 'rate',
  loadedmetadata: 'loaded',
  error: 'error',
}

interface PendingLoad { resolve(): void; reject(error: Error): void }

/** iPad Safari leaves HTMLMediaElement.volume at 1 whatever is set: probe it once, putting the volume back. */
function honoursVolume(audio: HTMLAudioElement): boolean {
  const before = audio.volume
  audio.volume = 0.5
  const works = audio.volume === 0.5
  audio.volume = before
  return works
}

/** The Web Audio path of a device that ignores the element volume: the element feeds one gain node. */
interface Routing { context: AudioContext; gain: GainNode }

/**
 * A player on an HTMLAudioElement with the pitch preserved at every speed. It never autoplays. Pass an element to use
 * your own (the tests do); otherwise it makes one and lets go of its file on destroy. Do not give it a VBR mp3: the
 * seek would not be exact (Decision 2026-10-27); it plays the transcoded file or the fakes' PCM click track.
 *
 * The level the ears get is the music volume times the fade. It is set on the element's volume, except where the device
 * ignores that (iPad Safari): there prepare(), called from a tap, routes the element through a Web Audio gain node, and
 * the level is set on the gain. The rate and the preserved pitch are the element's own and do not change either way.
 * `createContext` is for the tests.
 */
export function createFilePlayer(element?: HTMLAudioElement, createContext: () => AudioContext = () => new AudioContext()): Player {
  const audio = element ?? new Audio()
  const listeners = new Set<(event: PlayerEvent) => void>()
  let pending: PendingLoad[] = []
  let volume = 1
  let fade = 1
  const volumeWorks = honoursVolume(audio)
  let routing: Routing | null = null
  // A media element routed through Web Audio plays silence unless its file was fetched with CORS: ask for that before any
  // load, and only where the routing may come (the Supabase file URLs answer a CORS request).
  if (!volumeWorks) audio.crossOrigin = 'anonymous'

  audio.preload = 'auto'
  audio.autoplay = false
  audio.preservesPitch = true

  function applyLevel(): void {
    const level = volume * fade
    if (routing !== null) routing.gain.gain.value = level
    else if (volumeWorks) audio.volume = level
  }

  function emit(event: PlayerEvent): void {
    for (const listener of [...listeners]) listener(event)
  }

  function settle(error?: Error): void {
    const waiting = pending
    pending = []
    for (const load of waiting) {
      if (error === undefined) load.resolve()
      else load.reject(error)
    }
  }

  const handlers = Object.entries(ELEMENT_EVENTS).map(([name, event]): [string, () => void] => [
    name,
    () => {
      if (event === 'error') settle(new Error(LOAD_ERROR_MESSAGE))
      emit(event)
    },
  ])
  const onCanPlay = () => settle()
  for (const [name, handler] of handlers) audio.addEventListener(name, handler)
  audio.addEventListener('canplay', onCanPlay)

  function duration(): number | null {
    return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null
  }

  return {
    load(url) {
      return new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject })
        audio.src = url
        audio.load()
      })
    },

    async play() {
      if (routing !== null && routing.context.state === 'suspended') await routing.context.resume().catch(() => {})
      await audio.play()
    },

    pause() {
      audio.pause()
    },

    seek(timeSec) {
      const end = duration()
      const clamped = Math.max(0, end === null ? timeSec : Math.min(timeSec, end))
      audio.currentTime = clamped
    },

    getTime() {
      return audio.currentTime
    },

    getDuration: duration,

    isPlaying() {
      return !audio.paused && !audio.ended
    },

    setRate(rate) {
      if (!(rate >= SPEED_RANGE.min && rate <= SPEED_RANGE.max)) throw new RangeError(`speed ${rate} is not from ${SPEED_RANGE.min} to ${SPEED_RANGE.max}`)
      audio.playbackRate = rate
      audio.preservesPitch = true
    },

    getRateRange() {
      return SPEED_RANGE
    },

    setVolume(next) {
      volume = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 0
      applyLevel()
    },

    getVolume() {
      return volume
    },

    setFade(next) {
      fade = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 1
      applyLevel()
    },

    getFade() {
      return fade
    },

    prepare() {
      if (volumeWorks || routing !== null) return
      try {
        const context = createContext()
        const gain = context.createGain()
        // An element can be given to Web Audio once, for good: from here the gain is the only volume control.
        context.createMediaElementSource(audio).connect(gain)
        gain.connect(context.destination)
        routing = { context, gain }
        applyLevel()
        void context.resume().catch(() => {})
      } catch {
        // Without Web Audio the music plays at the device's own volume; the fade does nothing.
      }
    },

    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    destroy() {
      audio.pause()
      for (const [name, handler] of handlers) audio.removeEventListener(name, handler)
      audio.removeEventListener('canplay', onCanPlay)
      listeners.clear()
      void routing?.context.close().catch(() => {})
      routing = null
      settle(new Error(LOAD_ERROR_MESSAGE))
      if (element === undefined) {
        audio.removeAttribute('src')
        audio.load()
      }
    },
  }
}
