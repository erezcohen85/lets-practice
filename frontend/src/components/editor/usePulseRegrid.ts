import { useEffect, useRef } from 'react'
import { regridRefusalText, regridSentence } from '@/components/waveform/regridEdit'
import { type DetectedBeat } from '@/domain/beats'
import { type EditorDoc, type EditRefusal, type EditResult } from '@/domain/pieceEdits'
import { regridForPulse } from '@/domain/pulseRegrid'
import { strings } from '@/strings'

const grid = strings.dock.grid

export interface PulseRegridOptions {
  doc: EditorDoc
  /** The piece's detected beats; null while they load, or when there are none. */
  beats: readonly DetectedBeat[] | null
  /** Whether the beats have been read: false while they load, so "no beats" is only said once it is true. */
  beatsLoaded: boolean
  /** The recording's length, when the piece knows it; else the last beat is the end. */
  durationSec: number | null | undefined
  /** Records and saves an edit of the doc; gives the reason back when it was refused. */
  apply(result: EditResult): EditRefusal | null
  /** Settings > Editing > "Fix a wrong beat by itself": when the Editor opens a map whose Wrong beat card is waiting, do what the card's button does. */
  auto: boolean
  /** False while the Editor is still filling the bars the map opened without: the automatic re-grid waits for that step to finish. */
  ready: boolean
  /** Says what was done, in the hint line. */
  notify(sentence: string): void
}

/**
 * The Wrong beat card's edit (the processor heard the recording at another beat than the score's): the bar lines of the whole
 * piece go on the beats the flag says, as one step that also resolves the card; the sentence is the one the toolbar's controls say.
 * `regrid` is the card's button: it gives back the reason nothing changed, or null. While the beats load it does nothing and says
 * nothing (`canRegrid` is false then, and the page keeps the button off); once they have loaded, no beats is a reason of its own.
 * With `auto` on, the same is done once when the Editor opens (as soon as the beats are in and the opening fill is over), and never
 * again in the visit: not on Undo, not on Redo, not for a card that is resolved. When it changes nothing, it says nothing and the
 * card stays for the player to see.
 */
export function usePulseRegrid({ doc, beats, beatsLoaded, durationSec, apply, auto, ready, notify }: PulseRegridOptions) {
  const usable = beatsLoaded && beats !== null && beats.length >= 2 ? beats : null
  const regrid = (): string | null => {
    if (!beatsLoaded) return null
    if (usable === null) return grid.noBeats
    const outcome = regridForPulse(doc, usable, durationSec ?? usable[usable.length - 1].t)
    if (outcome === null) return grid.noWrongBeat
    const reason = apply(outcome.result)
    if (reason !== null) return regridRefusalText(reason)
    notify(regridSentence(outcome, null))
    return null
  }

  // The render's own regrid, for the effect below to call without being run again for every change of the doc.
  const latest = useRef(regrid)
  useEffect(() => {
    latest.current = regrid
  })
  const tried = useRef(false)
  useEffect(() => {
    if (!auto || !ready || usable === null || tried.current) return
    tried.current = true
    latest.current()
  }, [auto, ready, usable])

  return { regrid, canRegrid: beatsLoaded }
}
