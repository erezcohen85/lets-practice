import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { ProgressRing } from '@/components/processing/ProgressRing'
import { StepList } from '@/components/processing/StepList'
import { BackLink } from '@/components/shell/BackLink'
import { PageColumn } from '@/components/shell/PageColumn'
import { ErrorState, LoadingState } from '@/components/shell/StateCards'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button, buttonVariants } from '@/components/ui/button'
import { can } from '@/domain/access'
import { formatDuration } from '@/domain/pieceStatus'
import { partProgress, processingSteps, type StepId } from '@/domain/processingSteps'
import { useClients } from '@/lib/clients'
import { type PieceDetail } from '@/lib/dataClient'
import { jobErrorSentence, usePlan, usePlanGate } from '@/lib/plan'
import { retryJob, sentenceOf } from '@/lib/processorClient'
import { usePoll } from '@/lib/usePoll'
import { jobSignature, useStalled } from '@/lib/useStalled'
import { cn } from '@/lib/utils'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { strings } from '@/strings'

const t = strings.processing
const split = strings.split

const POLL_MS = 1000

// The board's "Back to library" button: full width, 56 px high, on the raised surface.
const backToLibraryClass = cn(buttonVariants({ variant: 'outline', size: 'xl' }), 'h-14 w-full bg-surface-2 text-[17px] dark:bg-surface-2')
const headingClass = 'text-[32px] leading-[1.3] font-bold tracking-[-0.01em]'

const isWorking = (detail: PieceDetail | null) => detail?.job?.status === 'queued' || detail?.job?.status === 'running'

/** What the finished steps found: the length of the recording, and how many parts and pages the PDFs have. */
function stepNotes(detail: PieceDetail): Partial<Record<StepId, string>> {
  const notes: Partial<Record<StepId, string>> = {}
  const length = formatDuration(detail.piece.recording?.durationSec ?? null)
  if (length !== '') notes.recording = length
  const pages = detail.parts.reduce((sum, part) => sum + part.pageCount, 0)
  if (pages > 0) notes.pdf = t.partsAndPages(detail.parts.length, pages)
  return notes
}

/** Preparing a piece: the job's progress as a ring and five steps, polled once a second until the piece is ready. */
export function ProcessingPage() {
  const { pieceId = '' } = useParams()
  // A new piece starts a fresh poll and a fresh retry state.
  return <ProcessingView key={pieceId} pieceId={pieceId} />
}

function ProcessingView({ pieceId }: { pieceId: string }) {
  const { data, processor } = useClients()
  const gate = usePlanGate()
  const { state: plan } = usePlan()
  const { value: detail, error, reload } = usePoll(() => data.getPiece(pieceId), { intervalMs: POLL_MS, while: isWorking })
  // The failed job that Try again has replaced; its error stays on screen until the poll brings the new job.
  const [retriedJobId, setRetriedJobId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // Try again could not start a job: how the job looked when it was pressed (so the sentence goes when the job moves on,
  // or another job takes its place), and the sentence the processor refused with, shown in place of the generic one.
  const [startFailed, setStartFailed] = useState<{ signature: string; sentence: string | null } | null>(null)
  // A job that is still queued or running but has not changed for ten minutes: the screen keeps waiting and offers Try again.
  const stalled = useStalled(detail?.job)

  if (error !== undefined) {
    return (
      <PageColumn width="narrow">
        <div>
          <BackLink />
        </div>
        <ErrorState
          title={t.loadFailedTitle}
          text={t.loadFailedText}
          actions={
            <>
              <Button size="xl" onClick={reload}>
                <ActionIcon action="retry" />
                {strings.common.retry}
              </Button>
              <Link to="/library" className={cn(buttonVariants({ variant: 'outline', size: 'xl' }))}>
                {t.backToLibrary}
              </Link>
            </>
          }
        />
      </PageColumn>
    )
  }

  if (detail === undefined) {
    return (
      <PageColumn width="narrow">
        <div>
          <BackLink />
        </div>
        <LoadingState message={t.loading} />
      </PageColumn>
    )
  }

  if (detail === null) return <NotFoundPage />
  // The processing screen is the owner's: a member's hub says "Being prepared" instead.
  if (!can(detail.piece.role, 'edit')) return <Navigate to={`/pieces/${pieceId}`} replace />

  const { job } = detail
  // Nothing to wait for: the piece is ready (or never started), and its hub is the place to be.
  if (job === null || job.status === 'done') return <Navigate to={`/pieces/${pieceId}`} replace />

  const steps = processingSteps(job)
  const part = partProgress(job)
  const notes = stepNotes(detail)

  const retry = async () => {
    if (starting) return
    setStarting(true)
    setStartFailed(null)
    try {
      // A retry the plan refuses opens the prompt, and is not a failed start.
      const started = await gate.run(null, async () => {
        await retryJob(processor, job)
        return true
      })
      if (started !== undefined) {
        setRetriedJobId(job.id)
        reload()
      }
    } catch (caught) {
      setStartFailed({ signature: jobSignature(job), sentence: sentenceOf(caught) })
    } finally {
      setStarting(false)
    }
  }

  if (job.status === 'error') {
    const waiting = starting || job.id === retriedJobId
    return (
      <PageColumn width="narrow">
        <div>
          <BackLink />
        </div>
        <h1 className={cn(headingClass, 'text-center')}>{t.title(detail.piece.title)}</h1>
        <div className="flex flex-col gap-3">
          <ErrorState
            title={t.failedTitle}
            lead={part?.kind === 'failed' ? split.couldNotRead(part.name) : undefined}
            text={jobErrorSentence(job.error, plan) ?? job.error ?? t.failedFallback}
            actions={
              <>
                <Button size="xl" disabled={waiting} onClick={() => void retry()}>
                  <ActionIcon action="retry" />
                  {waiting ? t.starting : strings.common.retry}
                </Button>
                <Link to="/library" className={cn(buttonVariants({ variant: 'outline', size: 'xl' }))}>
                  {t.backToLibrary}
                </Link>
              </>
            }
          />
          {startFailed?.signature === jobSignature(job) && (
            <p role="alert" className="text-center text-sm text-problem">
              {startFailed.sentence ?? t.retryFailed}
            </p>
          )}
        </div>
        <StepList steps={steps} notes={notes} />
      </PageColumn>
    )
  }

  return (
    <PageColumn width="narrow" className="min-h-[calc(100dvh-4rem)]">
      <div>
        <BackLink />
      </div>
      <section className="flex flex-col items-center gap-5 pt-6 text-center">
        <ProgressRing percent={job.progress * 100} />
        <div>
          <h1 className={headingClass}>{t.title(detail.piece.title)}</h1>
          <p className="mt-2 text-base leading-[1.3] text-text-soft">{t.leaveNote}</p>
          {part?.kind === 'reading' && (
            <p role="status" className="mt-2 text-base leading-[1.3] font-medium">
              {split.readingPart(part.name, part.position, part.total)}
            </p>
          )}
        </div>
      </section>
      <StepList steps={steps} notes={notes} />
      {stalled && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p role="status" className="text-base leading-[1.3] text-text-soft">
            {t.stalled}
          </p>
          <Button variant="outline" size="xl" disabled={starting} onClick={() => void retry()}>
            {starting ? t.starting : strings.common.retry}
          </Button>
          {startFailed?.signature === jobSignature(job) && (
            <p role="alert" className="text-sm text-problem">
              {startFailed.sentence ?? t.retryFailed}
            </p>
          )}
        </div>
      )}
      <Link to="/library" className={cn(backToLibraryClass, 'mt-auto')}>
        {t.backToLibrary}
      </Link>
    </PageColumn>
  )
}
