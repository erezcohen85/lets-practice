import { Pencil, PencilRuler, Play, Plus, Share2, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { EditorLink } from '@/components/editor/EditorLink'
import { AddPartsDialog } from '@/components/hub/AddPartsDialog'
import { DeletePieceDialog } from '@/components/hub/DeletePieceDialog'
import { JobFailedNotice } from '@/components/hub/JobFailedNotice'
import { MemberHub } from '@/components/hub/MemberHub'
import { PartRow } from '@/components/hub/PartRow'
import { RecordingCard } from '@/components/hub/RecordingCard'
import { RenamePieceDialog } from '@/components/hub/RenamePieceDialog'
import { ReviewBanner } from '@/components/hub/ReviewBanner'
import { ShareDialog } from '@/components/hub/ShareDialog'
import { SkippedPartsNotice } from '@/components/hub/SkippedPartsNotice'
import { quietActionClass } from '@/components/hub/styles'
import { piecesMadeOf } from '@/components/library/piecesMade'
import { BackLink } from '@/components/shell/BackLink'
import { TopBar } from '@/components/shell/TopBar'
import { PageColumn } from '@/components/shell/PageColumn'
import { ErrorState, LoadingState } from '@/components/shell/StateCards'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button, buttonVariants, glowClass } from '@/components/ui/button'
import { MoreMenu } from '@/components/ui/more-menu'
import { can } from '@/domain/access'
import { formatDuration, pagesOf, pieceState } from '@/domain/pieceStatus'
import { skippedParts } from '@/domain/processingSteps'
import { useClients } from '@/lib/clients'
import { jobErrorSentence, usePlan, usePlanGate } from '@/lib/plan'
import { retryJob, sentenceOf } from '@/lib/processorClient'
import { useSession } from '@/lib/session'
import { useFeatures } from '@/lib/useFeatures'
import { usePiecePlan } from '@/lib/usePiecePlan'
import { usePoll } from '@/lib/usePoll'
import { cn } from '@/lib/utils'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { strings } from '@/strings'

// A piece with a screen of its own gets one column: the 36 px title row and the cards, 24 px apart.
// The column is as tall as the window.
const columnClass = 'min-h-[calc(100dvh-4rem)] gap-6'

// The three big actions share one shape: a 64 px button with a glow, a round disc at its start, the label centred. They sit
// in a grid, one column on a phone and three from sm, so each fills its cell.
const bigButtonBase = cn(
  'inline-flex min-h-16 items-center justify-center gap-3 rounded-card ps-4 pe-6 text-xl font-bold',
  glowClass,
  'transition-colors outline-none',
  'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
)
// In the one-column layout the discs line up: content starts at the start edge, pushed in by half the button minus half the
// widest content (the disc, the gap and "Edit map"), so the group still looks centred. From sm the cells centre as before.
const stackedAlign = 'max-sm:justify-start max-sm:ps-[calc(50%-4.35rem)]'
const editMapClass = cn(bigButtonBase, stackedAlign, 'bg-edit text-on-edit [--lp-glow-colour:var(--lp-edit)] hover:bg-edit/90')
const shareClass = cn(bigButtonBase, stackedAlign, 'bg-share text-on-share [--lp-glow-colour:var(--lp-share)] hover:bg-share/90')
const practiceClass = cn(bigButtonBase, 'bg-primary text-on-primary hover:bg-primary/90')
const hubPracticeClass = cn(practiceClass, stackedAlign)
// A member's hub keeps its one Practice link beside the title, not stretched to a cell.
const memberPracticeClass = cn(practiceClass, 'shrink-0 ps-5 pe-8')

const quietButtonClass = cn(quietActionClass, 'px-[18px]')

/** The hub of one piece: practice it, practice one part, see how far the map has been checked, rename or delete it. */
export function PieceHubPage() {
  const { pieceId } = useParams()
  if (pieceId === undefined) return <NotFoundPage />
  // Keyed, so a hub opened for another piece starts again instead of showing the last one while it loads.
  return <PieceHub key={pieceId} pieceId={pieceId} />
}

function PieceHub({ pieceId }: { pieceId: string }) {
  const { data, processor } = useClients()
  const features = useFeatures()
  const { profile } = useSession()
  const gate = usePlanGate()
  const { state: plan, refresh: refreshPlan } = usePlan()
  // The plan with this piece's usage (its reads of each part): what Reprocess and its lines go by.
  const piecePlan = usePiecePlan(pieceId)
  const navigate = useNavigate()
  const partsId = useId()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [addingParts, setAddingParts] = useState(false)
  // The parts a failed start has already stored, and the rows they were made from: trying the same rows again starts the
  // job without storing the files a second time.
  const storedParts = useRef<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryFailed, setRetryFailed] = useState(false)
  // The sentence the processor refused the retry with (busy, uploads limited), shown in place of the generic one.
  const [retryRefusal, setRetryRefusal] = useState<string | null>(null)
  // Loaded once and again after a rename: a piece that is processing leaves for its processing screen, so there is
  // nothing here to poll.
  const {
    value: detail,
    error,
    reload,
  } = usePoll(() => data.getPiece(pieceId), { intervalMs: 1000, while: () => false })

  if (error !== undefined) {
    return (
      <PageColumn width="narrow" className={columnClass}>
        <TopBar />
        <BackLink />
        <ErrorState
          title={strings.hub.loadErrorTitle}
          text={strings.hub.loadErrorText}
          actions={
            <Button size="xl" onClick={reload}>
              <ActionIcon action="retry" />
              {strings.common.retry}
            </Button>
          }
        />
      </PageColumn>
    )
  }
  if (detail === undefined) {
    return (
      <PageColumn width="narrow" className={columnClass}>
        <TopBar />
        <BackLink />
        <LoadingState message={strings.hub.loading} />
      </PageColumn>
    )
  }
  if (detail === null) return <NotFoundPage />
  // A member's hub is the music and Practice; nothing of the owner's below runs for them.
  if (!can(detail.piece.role, 'edit')) return <MemberHub detail={detail} columnClass={columnClass} practiceClass={memberPracticeClass} />
  // An owner who may no longer upload keeps the piece, but starting reads (add a part, read a part again) is an upload's work.
  const uploads = profile !== null && features.upload

  const { piece } = detail
  const made = piecesMadeOf(piecePlan.state)
  const state = pieceState(detail.job, detail.review, pagesOf(detail))
  if (state === 'processing') return <Navigate to={`/pieces/${pieceId}/processing`} replace />

  const duration = formatDuration(piece.recording?.durationSec ?? null)
  const deleteDialog = (
    <DeletePieceDialog
      open={deleting}
      onOpenChange={setDeleting}
      title={piece.title}
      note={made === null ? undefined : strings.plans.deleteNote(made.plan, made.used, made.max)}
      onDelete={async () => {
        await data.deletePiece(pieceId)
        void refreshPlan()
        // The hub of a deleted piece has nothing to show, so going back must not land on it.
        void navigate('/library', { replace: true })
      }}
    />
  )
  // The title and its three-dot menu share a row; the summary sits under it. A piece that failed to read cannot be
  // renamed, so its menu has Delete only.
  const titleBlock = (menu: { rename: boolean }) => (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 text-4xl leading-[1.1] font-bold tracking-[-0.01em] break-words">{piece.title}</h1>
        <MoreMenu
          label={strings.hub.moreFor(piece.title)}
          items={[
            ...(menu.rename ? [{ label: strings.hub.rename, icon: Pencil, onSelect: () => setRenaming(true) }] : []),
            { label: strings.hub.delete, icon: Trash2, danger: true, onSelect: () => setDeleting(true) },
          ]}
        />
      </div>
      <p className="mt-2 text-[15px] leading-[1.3] text-text-muted">{strings.hub.summary(piece.parts.length, duration)}</p>
    </div>
  )

  const retry = async () => {
    setRetrying(true)
    setRetryFailed(false)
    setRetryRefusal(null)
    try {
      // A job that added parts runs again for those parts, a realign refits again, and only a failed first read starts the piece over.
      // A retry the plan refuses opens the prompt, and is not a failed retry.
      const started = await gate.run(null, async () => {
        await (detail.job === null ? processor.processPiece(pieceId) : retryJob(processor, detail.job))
        return true
      })
      if (started === undefined) {
        setRetrying(false)
        return
      }
      // Replacing the hub: going back from the processing screen must not land on a hub that sends it forward again.
      void navigate(`/pieces/${pieceId}/processing`, { replace: true })
    } catch (caught) {
      setRetryRefusal(sentenceOf(caught))
      setRetryFailed(true)
      setRetrying(false)
    }
  }

  if (state === 'failed') {
    return (
      <PageColumn width="narrow" className={columnClass}>
        <TopBar />
        <BackLink />
        {titleBlock({ rename: false })}
        <ErrorState
          title={strings.hub.failedTitle}
          text={retryFailed ? (retryRefusal ?? strings.hub.retryFailed) : (detail.job === null ? strings.hub.notStartedText : (jobErrorSentence(detail.job.error, plan) ?? detail.job.error ?? strings.hub.failedText))}
          actions={
            <>
              <Button size="xl" disabled={retrying} onClick={() => void retry()}>
                <ActionIcon action="retry" />
                {strings.common.retry}
              </Button>
              <Link to="/library" className={cn(buttonVariants({ variant: 'outline', size: 'xl' }))}>
                {strings.common.goToLibrary}
              </Link>
            </>
          }
        />
        {deleteDialog}
      </PageColumn>
    )
  }

  // What the plan says about reading each part again: the reads left, in the part's row (or under the list, for a piece of one part)
  // and in the question. Nothing for the admin and for a plan without that limit.
  const readAgain = (partId: string) => {
    const planNow = piecePlan.state
    if (planNow === null || planNow.is_admin || planNow.plan.read_again_per_part_max === null) return undefined
    const max = planNow.plan.read_again_per_part_max
    const left = Math.max(0, max - (planNow.piece?.read_again_by_part[partId] ?? 0))
    const name = planNow.plan.name
    return {
      check: () => piecePlan.check({ type: 'readAgain', partId }),
      left: strings.plans.readAgainLeft(name, left, max),
      confirm: strings.plans.readAgainConfirm(name, left),
    }
  }
  const readAgainOn = uploads && features.reprocess
  // A piece of one part says it once, under the list, as the board does; several parts say it each in their own row.
  const rowPlan = (partId: string) => {
    const again = readAgain(partId)
    return again === undefined ? undefined : { ...again, left: detail.parts.length > 1 ? again.left : null }
  }
  const onlyPartLeft = readAgainOn && detail.parts.length === 1 ? readAgain(detail.parts[0]!.id)?.left : undefined
  // Both main buttons open the part that was opened last; a part that is gone leaves the first one.
  const mainPart = (detail.parts.find((part) => part.id === piece.lastPartId) ?? detail.parts[0])?.id
  const partQuery = mainPart === undefined ? '' : `?part=${mainPart}`
  const needsReview = state === 'needs-review'
  const skipped = skippedParts(detail.job)
  // A Realign or Add part that ended in an error (not a part-by-part one, which the notice below names) says why here;
  // the piece keeps the map it had.
  const failedKind = detail.job?.status === 'error' && skipped.length === 0 && detail.job.kind !== 'process-piece' ? detail.job.kind : null
  return (
    <PageColumn width="narrow" className={columnClass}>
      <TopBar />
      <BackLink />
      {titleBlock({ rename: true })}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <EditorLink to={`/pieces/${pieceId}/edit${partQuery}`} className={editMapClass}>
          <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-full bg-on-edit">
            <PencilRuler className="size-[18px] text-edit" strokeWidth={2} />
          </span>
          {strings.hub.editMap}
        </EditorLink>
        {can(piece.role, 'share') && (
          <button type="button" className={shareClass} onClick={() => setSharing(true)}>
            <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-full bg-on-share">
              <Share2 className="size-[18px] text-share" strokeWidth={2} />
            </span>
            {strings.hub.shareButton}
          </button>
        )}
        <Link to={`/pieces/${pieceId}/practice${partQuery}`} className={hubPracticeClass}>
          {/* The triangle keeps pointing the way time runs, as the waveform does, in a right-to-left page too; only the disc moves to the start. */}
          <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-full bg-on-primary">
            <Play className="size-[18px] fill-current text-primary" strokeWidth={2} />
          </span>
          {strings.hub.practice}
        </Link>
      </div>

      {detail.job !== null && failedKind !== null && (
        <JobFailedNotice kind={failedKind} error={jobErrorSentence(detail.job.error, plan) ?? detail.job.error} retrying={retrying} retryFailed={retryFailed} refusal={retryRefusal} onRetry={() => void retry()} />
      )}

      {skipped.length > 0 && (
        <SkippedPartsNotice
          parts={skipped.map((part) => ({ ...part, error: jobErrorSentence(part.error, plan) ?? part.error }))}
          retrying={retrying}
          retryFailed={retryFailed}
          refusal={retryRefusal}
          onRetry={() => {
            setRetrying(true)
            setRetryFailed(false)
            setRetryRefusal(null)
            // The skipped PDFs are new parts to the piece: an add-parts job reads them, never the whole piece again.
            gate.run(null, () => processor.addParts(pieceId, [])).then(
              (job) => {
                if (job === undefined) setRetrying(false) // the plan refused it: the prompt is open
                else void navigate(`/pieces/${pieceId}/processing`, { replace: true })
              },
              (caught: unknown) => {
                setRetryRefusal(sentenceOf(caught))
                setRetryFailed(true)
                setRetrying(false)
              },
            )
          }}
        />
      )}

      {needsReview && <ReviewBanner checked={detail.review.checked} total={detail.review.total} />}

      <RecordingCard
        pieceId={pieceId}
        label={detail.recordingLabel}
        durationSec={piece.recording?.durationSec ?? null}
        onRename={async (name) => {
          await data.renameRecording(pieceId, name)
          reload()
        }}
      />

      <section className="flex flex-col gap-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h2 id={partsId} className="text-lg leading-[1.3] font-semibold">
            {strings.hub.parts}
          </h2>
          {uploads && (
            <Button
              variant="outline"
              size="touch"
              className={cn(quietButtonClass, 'gap-2 text-primary-strong hover:text-primary-strong')}
              onClick={() => {
                // The plan's limit on parts is asked before the dialog opens.
                if (piecePlan.check({ type: 'addPart', partsAfter: detail.parts.length + 1 })) setAddingParts(true)
              }}
            >
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              {strings.hub.addPart}
            </Button>
          )}
        </div>
        <ul aria-labelledby={partsId} className="flex flex-col gap-3">
          {detail.parts.map((part) => (
            <PartRow
              key={part.id}
              pieceId={pieceId}
              part={part}
              isLast={detail.parts.length === 1}
              onDelete={async () => {
                await data.deletePart(pieceId, part.id)
                reload()
              }}
              onRename={async (name) => {
                await data.renamePart(pieceId, part.id, name)
                reload()
              }}
              onReprocess={
                uploads && features.reprocess
                  ? async (boxCheck) => {
                      const started = await piecePlan.attempt(null, async () => {
                        await processor.reprocessPart(pieceId, part.id, { boxCheck })
                        // Replacing the hub: going back from the processing screen must not land on a hub that sends it forward again.
                        void navigate(`/pieces/${pieceId}/processing`, { replace: true })
                      })
                      return started ? undefined : false
                    }
                  : undefined
              }
              reprocessPlan={readAgainOn ? rowPlan(part.id) : undefined}
            />
          ))}
        </ul>
        {onlyPartLeft !== undefined && <p className="text-sm text-text-muted">{onlyPartLeft}</p>}
      </section>

      <AddPartsDialog
        open={addingParts}
        onOpenChange={setAddingParts}
        readPartName={(pdf) => processor.readPartName(pdf)}
        proposeSplit={(pdf) => processor.proposeSplit(pdf)}
        existing={detail.parts.length}
        onAdd={async (parts, split) => {
          const signature = JSON.stringify(split === undefined ? parts.map(({ file, name }) => [name, file.name, file.size, file.lastModified]) : [split.splitId, split.parts])
          // The plan may refuse at the database (too many parts) or at the processor (Advanced Reading): the prompt opens, and the dialog stays.
          const added = await piecePlan.attempt(null, async () => {
            if (storedParts.current !== signature) {
              await data.storeParts(pieceId, parts, split)
              storedParts.current = signature
            }
            // With no new files the job runs for the parts that have no pages yet: the ones just stored.
            await processor.addParts(pieceId, [])
            // Replacing the hub: going back from the processing screen must not land on a hub that sends it forward again.
            void navigate(`/pieces/${pieceId}/processing`, { replace: true })
          })
          return added ? undefined : false
        }}
      />
      <RenamePieceDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={piece.title}
        suggest={features.suggestName ? () => processor.suggestPieceName(pieceId) : undefined}
        onRename={async (title) => {
          await data.renamePiece(pieceId, title)
          reload()
        }}
      />
      <ShareDialog pieceId={pieceId} open={sharing} onOpenChange={setSharing} />
      {deleteDialog}
    </PageColumn>
  )
}
