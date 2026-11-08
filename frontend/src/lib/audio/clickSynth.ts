import { type ClickTone } from '@/domain/types'

export interface ClickSynth {
  /** Plays a click `delaySec` from now (wall clock), accented or not, in the tone, at the volume 0..1. */
  schedule(delaySec: number, accent: boolean): void
  setTone(tone: ClickTone): void
  setVolume(volume: number): void
  /** Cancels every click not yet sounded (pause, seek, loop wrap). */
  cancelAll(): void
  /** Browsers start audio only after a gesture: call from the first tap. */
  resume(): Promise<void>
  destroy(): void
}

export const DEFAULT_CLICK_VOLUME = 0.8

interface ToneSpec { type: OscillatorType; hz: number; lengthSec: number }

// Built from oscillators, no sample files. The accent is the same tone one octave up.
const TONES: Record<ClickTone, ToneSpec> = {
  wood: { type: 'triangle', hz: 900, lengthSec: 0.025 },
  click: { type: 'square', hz: 2000, lengthSec: 0.01 },
  beep: { type: 'sine', hz: 1000, lengthSec: 0.06 },
}

const ATTACK_SEC = 0.001
const SILENCE = 0.0001
const PLAIN_LEVEL = 0.6   // a plain click's peak, as a share of the accent's
// The oscillator outlives the audible decay a little, so the exponential ramp finishes before the stop.
const TAIL_SEC = 0.05

interface Pending { oscillator: OscillatorNode; gain: GainNode }

/** Clicks on Web Audio. Without a context it makes one on the first schedule or resume, never before. */
export function createClickSynth(context?: AudioContext): ClickSynth {
  let ctx = context
  let ownsContext = false
  let tone: ClickTone = 'wood'
  let volume = DEFAULT_CLICK_VOLUME
  let destroyed = false
  const pending = new Set<Pending>()

  function getContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext()
      ownsContext = true
    }
    return ctx
  }

  function release(source: Pending) {
    source.oscillator.disconnect()
    source.gain.disconnect()
    pending.delete(source)
  }

  function cancelAll() {
    for (const source of [...pending]) {
      source.oscillator.stop(0)
      release(source)
    }
  }

  return {
    schedule(delaySec, accent) {
      if (destroyed || volume <= 0) return
      const audio = getContext()
      const spec = TONES[tone]
      const start = audio.currentTime + Math.max(0, delaySec)
      const peak = volume * (accent ? 1 : PLAIN_LEVEL)

      const oscillator = audio.createOscillator()
      oscillator.type = spec.type
      oscillator.frequency.value = accent ? spec.hz * 2 : spec.hz
      const gain = audio.createGain()
      gain.gain.setValueAtTime(SILENCE, start)
      gain.gain.linearRampToValueAtTime(peak, start + ATTACK_SEC)
      gain.gain.exponentialRampToValueAtTime(SILENCE, start + ATTACK_SEC + spec.lengthSec)
      oscillator.connect(gain)
      gain.connect(audio.destination)

      const source = { oscillator, gain }
      pending.add(source)
      oscillator.addEventListener('ended', () => release(source))
      oscillator.start(start)
      oscillator.stop(start + ATTACK_SEC + spec.lengthSec + TAIL_SEC)
    },
    setTone(next) { tone = next },
    setVolume(next) { volume = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0 },
    cancelAll,
    async resume() {
      if (destroyed) return
      await getContext().resume()
    },
    destroy() {
      cancelAll()
      destroyed = true
      if (ctx && ownsContext) void ctx.close()
    },
  }
}
