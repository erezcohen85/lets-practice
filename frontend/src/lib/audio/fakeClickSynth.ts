import { type ClickTone } from '@/domain/types'
import { DEFAULT_CLICK_VOLUME, type ClickSynth } from '@/lib/audio/clickSynth'

export interface ScheduledClick { delaySec: number; accent: boolean; tone: ClickTone; volume: number }

/** `scheduled` holds the clicks not yet cancelled; `cancelCalls` counts cancelAll calls. */
export interface FakeClickSynth extends ClickSynth {
  scheduled: ScheduledClick[]
  cancelCalls: number
}

/** A click synth that makes no sound: it records each click with the tone and volume in force when it was scheduled. */
export function createFakeClickSynth(): FakeClickSynth {
  let tone: ClickTone = 'wood'
  let volume = DEFAULT_CLICK_VOLUME
  const synth: FakeClickSynth = {
    scheduled: [],
    cancelCalls: 0,
    schedule(delaySec, accent) {
      if (volume > 0) synth.scheduled.push({ delaySec, accent, tone, volume })
    },
    setTone(next) { tone = next },
    setVolume(next) { volume = Math.min(1, Math.max(0, next)) },
    cancelAll() {
      synth.scheduled = []
      synth.cancelCalls += 1
    },
    async resume() {},
    destroy() { synth.scheduled = [] },
  }
  return synth
}
