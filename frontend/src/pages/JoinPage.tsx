import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { PageColumn } from '@/components/shell/PageColumn'
import { ErrorState, LoadingState } from '@/components/shell/StateCards'
import { ActionIcon } from '@/components/ui/action-icon'
import { buttonVariants } from '@/components/ui/button'
import { useClients } from '@/lib/clients'
import { type JoinResult } from '@/lib/dataClient'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

export function JoinPage() {
  const { token = '' } = useParams()
  // Keyed, so a second link opened on the same mounted page joins again instead of showing the first answer.
  return <Join key={token} token={token} />
}

/** A join answer, and for a member whether they are on hold for the piece (they cannot open it then). */
type Answer = JoinResult & { held?: boolean }

/**
 * Opening a share link. It joins once per token: StrictMode runs an effect twice, and the second answer
 * ("already_member") would lose the "Added to your library" note. A member on hold is told so here instead of being sent
 * to a piece they cannot open; if the held pieces cannot be read, they go to the piece as before.
 */
function Join({ token }: { token: string }) {
  const { data } = useClients()
  const started = useRef(false)
  const [result, setResult] = useState<Answer | 'failed' | null>(null)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const answer = async (): Promise<Answer> => {
      const joined = await data.joinPiece(token)
      if (joined.status !== 'already_member') return joined
      const held = await data.listHeldPieces().catch(() => [])
      return { ...joined, held: held.some((piece) => piece.id === joined.pieceId) }
    }
    answer().then(setResult, () => setResult('failed'))
  }, [data, token])

  if (result === null) {
    return (
      <PageColumn width="narrow">
        <LoadingState message={strings.join.loading} />
      </PageColumn>
    )
  }
  if (result !== 'failed' && result.pieceId !== null && result.held !== true) {
    return (
      <Navigate to={`/pieces/${result.pieceId}`} replace state={result.status === 'joined' ? { joined: true } : null} />
    )
  }
  const text =
    result === 'failed'
      ? strings.join.failed
      : result.held === true
        ? strings.join.onHold
        : result.status === 'link_off'
          ? strings.join.linkOff
          : result.status === 'full'
            ? strings.join.full
            : strings.join.notFound
  return (
    <PageColumn width="narrow">
      <ErrorState
        title={strings.join.title}
        text={text}
        actions={
          <Link to="/library" className={cn(buttonVariants({ size: 'xl' }))}>
            <ActionIcon action="library" />
            {strings.common.goToLibrary}
          </Link>
        }
      />
    </PageColumn>
  )
}
