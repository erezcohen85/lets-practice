import { useEffect, useRef, useState } from 'react'
import { createClickSynth, type ClickSynth } from '@/lib/audio/clickSynth'
import { useClients } from '@/lib/clients'
import { createFilePlayer } from '@/lib/player/filePlayer'
import { type Player } from '@/lib/player/player'

export interface PracticeMedia { player: Player; synth: ClickSynth; peaks: number[] | null }

export type MediaState = { status: 'loading' } | { status: 'failed'; reason: 'no-recording' | 'load' } | ({ status: 'ready' } & PracticeMedia)

/**
 * The player and the click synth of Practice with the recording loaded and the waveform peaks read. They are made in an
 * effect and destroyed when the page leaves (or the piece changes), so React running effects twice never leaves the page
 * with a destroyed one. Every piece plays its stored recording through the file player.
 */
export function usePracticeMedia(pieceId: string): MediaState {
  const { data, createPlayer, createClickSynth: makeSynth } = useClients()
  const makePlayer = useRef(createPlayer ?? createFilePlayer)
  const makeClicks = useRef(makeSynth ?? createClickSynth)
  const [state, setState] = useState<{ pieceId: string; media: MediaState }>({ pieceId, media: { status: 'loading' } })

  useEffect(() => {
    let cancelled = false
    const player = makePlayer.current()
    const synth = makeClicks.current()
    Promise.all([data.getPeaks(pieceId), data.getAudioUrl(pieceId)]).then(
      async ([peaks, url]) => {
        if (url === null) {
          if (!cancelled) setState({ pieceId, media: { status: 'failed', reason: 'no-recording' } })
          return
        }
        try {
          await player.load(url)
        } catch {
          if (!cancelled) setState({ pieceId, media: { status: 'failed', reason: 'load' } })
          return
        }
        if (!cancelled) setState({ pieceId, media: { status: 'ready', player, synth, peaks } })
      },
      () => {
        if (!cancelled) setState({ pieceId, media: { status: 'failed', reason: 'load' } })
      },
    )
    return () => {
      cancelled = true
      player.destroy()
      synth.destroy()
      setState({ pieceId, media: { status: 'loading' } })
    }
  }, [data, pieceId])

  return state.pieceId === pieceId ? state.media : { status: 'loading' }
}
