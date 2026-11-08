import { useEffect } from 'react'
import { useClients } from '@/lib/clients'

/** Tells the piece which part the editor or Practice has open, each time it opens or switches; the hub's main buttons open that part. */
export function useRememberPart(pieceId: string, partId: string): void {
  const { data } = useClients()
  useEffect(() => {
    // Remembering is a convenience: a failed save must not disturb the screen.
    data.setLastPart(pieceId, partId).catch(() => {})
  }, [data, pieceId, partId])
}
