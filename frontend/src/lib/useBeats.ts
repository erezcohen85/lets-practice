import { useEffect, useState } from 'react'
import { type DetectedBeat } from '@/domain/beats'
import { useClients } from '@/lib/clients'

/** The beats the DataClient has for the piece, and whether they have been read: `beats` is null while loading and also when there are none. */
export interface BeatsRead {
  beats: DetectedBeat[] | null
  loaded: boolean
}

/**
 * The beats the DataClient has for the piece: null while loading, and null when it has none (or they could not be read; the dock then divides the bars).
 * `loaded` tells the two apart. The Editor reads them once and hands them to the dock, so the Wrong beat card and the dock work from the same beats;
 * `enabled` false reads nothing (and `loaded` stays false).
 */
export function useBeatsRead(pieceId: string, enabled = true): BeatsRead {
  const { data } = useClients()
  const [state, setState] = useState<{ pieceId: string; beats: DetectedBeat[] | null } | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    data.getBeats(pieceId).then(
      (beats) => {
        if (!cancelled) setState({ pieceId, beats })
      },
      () => {
        if (!cancelled) setState({ pieceId, beats: null })
      },
    )
    return () => {
      cancelled = true
    }
  }, [data, pieceId, enabled])
  const current = enabled && state?.pieceId === pieceId ? state : undefined
  return { beats: current?.beats ?? null, loaded: current !== undefined }
}

/** The beats the DataClient has for the piece: null while loading, and null when it has none (see useBeatsRead for telling those apart). */
export function useBeats(pieceId: string, enabled = true): DetectedBeat[] | null {
  return useBeatsRead(pieceId, enabled).beats
}
