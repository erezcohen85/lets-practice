import { useEffect, useRef, useState } from 'react'
import { useClients } from '@/lib/clients'
import { createFilePlayer } from '@/lib/player/filePlayer'
import { type Player } from '@/lib/player/player'

/**
 * A player that belongs to the screen: made when it mounts and destroyed when it unmounts. It is made in an effect, not at
 * the first render, so that React running the effects twice (StrictMode) never leaves the page holding a destroyed one.
 * null until it exists. Making a player loads nothing: the recording loads when the screen asks it to.
 */
export function useOwnedPlayer(): Player | null {
  const { createPlayer } = useClients()
  const make = useRef(createPlayer ?? createFilePlayer)
  const [player, setPlayer] = useState<Player | null>(null)
  useEffect(() => {
    const made = make.current()
    setPlayer(made)
    return () => {
      made.destroy()
      setPlayer(null)
    }
  }, [])
  return player
}
