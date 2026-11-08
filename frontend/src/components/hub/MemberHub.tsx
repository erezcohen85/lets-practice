import { Play } from 'lucide-react'
import { useId, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { LeavePieceDialog } from '@/components/hub/LeavePieceDialog'
import { RecordingCard } from '@/components/hub/RecordingCard'
import { partPracticeLinkClass, quietActionClass } from '@/components/hub/styles'
import { BackLink } from '@/components/shell/BackLink'
import { PageColumn } from '@/components/shell/PageColumn'
import { TopBar } from '@/components/shell/TopBar'
import { EmptyState } from '@/components/shell/StateCards'
import { Button } from '@/components/ui/button'
import { formatDuration, memberPreparing } from '@/domain/pieceStatus'
import { useClients } from '@/lib/clients'
import { type PieceDetail } from '@/lib/dataClient'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

/**
 * What someone who joined a piece sees: the music and Practice. Nothing here changes the piece; Leave changes only their
 * membership. "Being prepared" is only the first read of the piece: a realign or an added part that runs or fails leaves
 * the piece to practise, so an owner's failed realign never locks members out of a good map.
 */
export function MemberHub({ detail, columnClass, practiceClass }: { detail: PieceDetail; columnClass: string; practiceClass: string }) {
  const { data } = useClients()
  const navigate = useNavigate()
  const { state: navigationState } = useLocation()
  const partsId = useId()
  const [leaving, setLeaving] = useState(false)
  const { piece } = detail
  const preparing = memberPreparing(detail.job)
  // Both main buttons open the part that was opened last; a part that is gone leaves the first one.
  const mainPart = (detail.parts.find((part) => part.id === piece.lastPartId) ?? detail.parts[0])?.id
  const partQuery = mainPart === undefined ? '' : `?part=${mainPart}`
  const joined = (navigationState as { joined?: boolean } | null)?.joined === true

  return (
    <PageColumn width="narrow" className={columnClass}>
      <TopBar />
      <div className="flex items-center justify-between gap-3">
        <BackLink />
        <Button variant="outline" size="touch" className={cn(quietActionClass, 'px-[18px]')} onClick={() => setLeaving(true)}>
          {strings.hub.leave}
        </Button>
      </div>
      {joined && (
        <p role="status" className="text-[15px] text-anchor">
          {strings.hub.joinedNote}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-4xl leading-[1.1] font-bold tracking-[-0.01em] break-words">{piece.title}</h1>
          <p className="mt-2 text-[15px] leading-[1.3] text-text-muted">
            {strings.hub.summary(piece.parts.length, formatDuration(piece.recording?.durationSec ?? null))}
          </p>
          {piece.ownerName !== null && <p className="mt-1 text-[15px] leading-[1.3] text-text-soft">{strings.hub.sharedBy(piece.ownerName)}</p>}
        </div>
        {!preparing && (
          <Link to={`/pieces/${piece.id}/practice${partQuery}`} className={practiceClass}>
            {/* The triangle keeps pointing the way time runs, as the waveform does, in a right-to-left page too; only the disc moves to the start. */}
            <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-full bg-on-primary">
              <Play className="size-[18px] fill-current text-primary" strokeWidth={2} />
            </span>
            {strings.hub.practice}
          </Link>
        )}
      </div>
      {preparing ? (
        <EmptyState title={strings.hub.beingPreparedTitle} text={strings.hub.beingPreparedText} />
      ) : (
        <>
          <RecordingCard pieceId={piece.id} label={detail.recordingLabel} durationSec={piece.recording?.durationSec ?? null} />
          <section className="flex flex-col gap-3">
            <h2 id={partsId} className="text-lg leading-[1.3] font-semibold">
              {strings.hub.parts}
            </h2>
            <ul aria-labelledby={partsId} className="flex flex-col gap-3">
              {detail.parts.map((part) => (
                <li key={part.id} className="flex items-center gap-4 rounded-lg border border-border bg-surface px-5 py-4">
                  <div className="min-w-0 flex-1 text-[17px] leading-snug font-semibold break-words">{part.name}</div>
                  <Link
                    to={`/pieces/${piece.id}/practice?part=${part.id}`}
                    aria-label={strings.hub.practicePart(part.name)}
                    title={strings.hub.practice}
                    className={partPracticeLinkClass}
                  >
                    <Play className="size-5 fill-current" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <LeavePieceDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={piece.title}
        onLeave={async () => {
          await data.leavePiece(piece.id)
          // The hub of a piece they left has nothing to show, so going back must not land on it.
          void navigate('/library', { replace: true })
        }}
      />
    </PageColumn>
  )
}
