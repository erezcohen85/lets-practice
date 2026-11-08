import { useCallback, useEffect, useState } from 'react'
import { useClients } from '@/lib/clients'
import { type PageImage } from '@/lib/dataClient'

/** The page images of one part, loaded again when the part changes; `pages` is undefined while they load (or after an error). */
export function usePartPages(pieceId: string, partId: string) {
  const { data } = useClients()
  const key = `${pieceId}:${partId}`
  const [state, setState] = useState<{ key: string; pages?: PageImage[]; failed?: boolean }>({ key: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    data.getPartPages(pieceId, partId).then(
      (pages) => active && setState({ key, pages }),
      () => active && setState({ key, failed: true }),
    )
    return () => {
      active = false
    }
  }, [data, pieceId, partId, key, attempt])

  const retry = useCallback(() => {
    setState({ key: '' })
    setAttempt((count) => count + 1)
  }, [])
  const current = state.key === key ? state : undefined
  return { pages: current?.pages, failed: current?.failed === true, retry }
}
