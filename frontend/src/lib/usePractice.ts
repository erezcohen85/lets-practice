import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { type CountInFade } from '@/domain/countInFade'
import { type SlotTiming } from '@/domain/tempo'
import { type CountInBars, type ListedMark, type PracticeMemory } from '@/domain/types'
import { type ClickSynth } from '@/lib/audio/clickSynth'
import { useClients } from '@/lib/clients'
import { type Player } from '@/lib/player/player'
import { createPracticeEngine, type PracticeControls, type PracticeState } from '@/lib/practiceEngine'

export type { PracticeControls, PracticeState }

/**
 * The Practice loop engine on a player and a click synth: the loop with its count-in, the metronome, the speed and the
 * volumes, and what the piece remembers of them (saved at most every 500 ms of changes, and on unmount). The player,
 * the synth, the piece, and the initial values are read once; the timeline, the marks and the count-in fade may change. The hook does not
 * destroy the player or the synth: whoever made them does.
 */
export function usePractice(input: {
  player: Player
  synth: ClickSynth
  timeline: SlotTiming[]
  /** The fermatas of the timing and the rests of the part being practised: what stops a count-in from replaying the bars before the loop. */
  marks: ListedMark[]
  pieceId: string
  initialCountInBars: CountInBars
  initialMemory: PracticeMemory
  countInFade: CountInFade
}): [PracticeState, PracticeControls] {
  const { data } = useClients()
  const [engine] = useState(() => createPracticeEngine({ ...input, data }))
  const { timeline, marks, countInFade } = input

  useLayoutEffect(() => {
    engine.update({ data, timeline, marks, countInFade })
  }, [engine, data, timeline, marks, countInFade])

  useEffect(() => {
    engine.start()
    return () => engine.stop()
  }, [engine])

  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  return [state, engine.controls]
}
