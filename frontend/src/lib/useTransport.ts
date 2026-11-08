import { useCallback, useEffect, useState } from 'react'
import { type Player } from '@/lib/player/player'

export interface Transport {
  /** The recording has loaded and can play. */
  ready: boolean
  playing: boolean
  /** Recording time in seconds; updated on every animation frame while playing. */
  timeSec: number
  durationSec: number | null
  /** The recording could not be loaded. */
  error: boolean
  toggle(): void
  seek(t: number): void
}

// What the hook knows about one (player, url) pair; a snapshot of another pair is ignored, so changing the url starts clean.
interface Snapshot { player: Player; url: string | null; ready: boolean; playing: boolean; timeSec: number; durationSec: number | null; error: boolean }

function fresh(player: Player, url: string | null): Snapshot {
  return { player, url, ready: false, playing: false, timeSec: 0, durationSec: null, error: false }
}

/**
 * Loads `url` into `player` and follows it: ready, playing, the duration and the time. While playing, the time comes
 * from the player on every animation frame; the frame loop stops on pause, at the end and on unmount. The hook does
 * not destroy the player: whoever made it does.
 */
export function useTransport(player: Player, url: string | null): Transport {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => fresh(player, url))
  const current = snapshot.player === player && snapshot.url === url ? snapshot : fresh(player, url)

  const update = useCallback(
    (change: (previous: Snapshot) => Partial<Snapshot>) => {
      setSnapshot((previous) => {
        const base = previous.player === player && previous.url === url ? previous : fresh(player, url)
        return { ...base, ...change(base) }
      })
    },
    [player, url],
  )

  useEffect(() => {
    if (url === null) return
    let cancelled = false
    const unsubscribe = player.onChange((event) => {
      update(() => ({
        playing: player.isPlaying(),
        timeSec: player.getTime(),
        durationSec: player.getDuration(),
        ...(event === 'error' ? { error: true } : {}),
      }))
    })
    player.load(url).then(
      () => {
        if (!cancelled) update(() => ({ ready: true, error: false, durationSec: player.getDuration(), timeSec: player.getTime() }))
      },
      () => {
        if (!cancelled) update(() => ({ ready: false, error: true }))
      },
    )
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [player, url, update])

  const playing = current.playing
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      update(() => ({ timeSec: player.getTime() }))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, player, update])

  const toggle = useCallback(() => {
    if (!current.ready) return
    if (player.isPlaying()) player.pause()
    else player.play().catch(() => {}) // a refused play leaves the player paused, which the state already shows
  }, [current.ready, player])

  const seek = useCallback(
    (t: number) => {
      player.seek(t)
      update(() => ({ timeSec: player.getTime() }))
    },
    [player, update],
  )

  return {
    ready: current.ready,
    playing: current.playing,
    timeSec: current.timeSec,
    durationSec: current.durationSec,
    error: current.error,
    toggle,
    seek,
  }
}
