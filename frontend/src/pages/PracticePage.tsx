import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { DemoCredits } from '@/components/demo/DemoCredits'
import { CountLabel } from '@/components/practice/CountLabel'
import { createFollowClock } from '@/components/practice/followClock'
import { FollowLayer } from '@/components/practice/FollowLayer'
import { OverviewStrip } from '@/components/practice/OverviewStrip'
import { PracticeToolbar } from '@/components/practice/PracticeToolbar'
import { loopVars } from '@/components/practice/loopColour'
import { PracticeTopBar } from '@/components/practice/PracticeTopBar'
import { RangeLayer } from '@/components/practice/RangeLayer'
import { useFollowScroll } from '@/components/practice/useFollowScroll'
import { usePicking } from '@/components/practice/usePicking'
import { usePracticeKeys } from '@/components/practice/usePracticeKeys'
import { useNoPageZoom } from '@/components/practice/useNoPageZoom'
import { usePhoneLayout } from '@/components/practice/usePhoneLayout'
import { usePracticeMedia, type PracticeMedia } from '@/components/practice/usePracticeMedia'
import { useRangeEdges } from '@/components/practice/useRangeEdges'
import { usePartPages } from '@/components/editor/usePartPages'
import { useSettingsSaver } from '@/components/settings/useSettingsSaver'
import { ScoreView, type BarFocus, type BarState, type ScrollRequest } from '@/components/score/ScoreView'
import { BackLink } from '@/components/shell/BackLink'
import { PageColumn } from '@/components/shell/PageColumn'
import { ErrorState } from '@/components/shell/StateCards'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { countLabelSpot } from '@/domain/countLabel'
import { barFromParam } from '@/domain/linkedSelection'
import { listedMarks } from '@/domain/markRanges'
import { can } from '@/domain/access'
import { memberPreparing, pagesOf, pieceState } from '@/domain/pieceStatus'
import { CURSOR_SLACK_SEC, followTarget, loopTimes, rangeLabel } from '@/domain/practice'
import { positionNearTime } from '@/domain/rangeEdges'
import { buildTimeline, slotIndexAt } from '@/domain/tempo'
import { type BarNumber, type PageLayer, type PieceMap } from '@/domain/types'
import { BarNamesProvider } from '@/lib/BarNamesProvider'
import { useBarNamesOf } from '@/lib/barNamesContext'
import { useClients } from '@/lib/clients'
import { useRememberPart } from '@/lib/useRememberPart'
import { type PageImage, type PieceDetail, type PlaybackSettings, type UserSettings } from '@/lib/dataClient'
import { useSession } from '@/lib/session'
import { usePractice } from '@/lib/usePractice'
import { usePoll } from '@/lib/usePoll'
import { cn } from '@/lib/utils'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { strings } from '@/strings'

const text = strings.practice

// Night score (Settings): the page images turn to white notes on black. Only the image is inverted, so the tint, the
// handles and the choice keep their colours, and the bar numbers drawn over the page turn to paper.
const NIGHT_SCORE_CLASS = '[&_[data-slot=score-page]>img]:invert [&_[data-slot=bar-box]>span]:text-paper'

type Loaded =
  | { status: 'missing' }
  | { status: 'processing' }
  | { status: 'ready'; detail: PieceDetail; map: PieceMap; settings: UserSettings }

/**
 * Where the screen is and how it is entered, passed in by the page that shows it: the way back (a link at the start of the top
 * bar and of the failure cards), the screen's own path (the Practice side of the Practice / Edit switch) and whether the piece
 * can be edited from here (no: no switch at all). The piece itself and everything the screen reads come from the clients above it.
 */
export interface PracticeSetting {
  back: { to: string; label: string }
  basePath: string
  editable: boolean
  /** A small line under the toolbar: the demo's credits. */
  footer?: ReactNode
}

/** Practice: the score of one part (`?part=`) with the loop picked on it, the overview strip and the toolbar; `?bar=` opens on a bar. */
export function PracticePage() {
  const { pieceId } = useParams()
  if (pieceId === undefined) return <NotFoundPage />
  // Keyed, so Practice opened for another piece starts again, with its own player and loop.
  return <PracticeScreen key={pieceId} pieceId={pieceId} setting={{ back: { to: `/pieces/${pieceId}`, label: text.pieceHub }, basePath: `/pieces/${pieceId}/practice`, editable: true }} />
}

/** The Practice screen of one piece, for the route of a piece and for the public demo alike. */
export function PracticeScreen({ pieceId, setting }: { pieceId: string; setting: PracticeSetting }) {
  const { data } = useClients()
  // Loaded once: Practice changes no map data. A piece still processing has empty layers, so its status is read first.
  const { value, error, reload } = usePoll<Loaded>(
    async () => {
      const detail = await data.getPiece(pieceId)
      if (detail === null) return { status: 'missing' }
      // For a member only the first read keeps the piece from Practice: a realign or an added part running for the owner leaves the map to practise on.
      const preparing = can(detail.piece.role, 'edit') ? pieceState(detail.job, detail.review, pagesOf(detail)) === 'processing' : memberPreparing(detail.job)
      if (preparing) return { status: 'processing' }
      const [map, profile] = await Promise.all([data.getPieceMap(pieceId), data.getProfile()])
      return map === null || detail.parts.length === 0 ? { status: 'missing' } : { status: 'ready', detail, map, settings: profile.settings }
    },
    { intervalMs: 1000, while: () => false },
  )

  if (error !== undefined) {
    return (
      <PageColumn width="narrow">
        <BackLink to={setting.back.to}>{setting.back.label}</BackLink>
        <ErrorState
          title={text.loadErrorTitle}
          text={text.loadErrorText}
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
  if (value === undefined) return <PracticeSkeleton back={setting.back} message={text.loading} />
  if (value.status === 'missing') return <NotFoundPage />
  if (value.status === 'processing') return <Navigate to={`/pieces/${pieceId}/processing`} replace />
  return <WithMedia pieceId={pieceId} detail={value.detail} map={value.map} settings={value.settings} setting={setting} />
}

/** Practice before the piece has loaded: the way back and a pulsing page. */
function PracticeSkeleton({ back, message }: { back: PracticeSetting['back']; message: string }) {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-4xl flex-col gap-4 px-4">
      <div className="py-3">
        <BackLink to={back.to}>{back.label}</BackLink>
      </div>
      <div role="status" aria-label={strings.common.loading} className="flex min-h-0 flex-1 flex-col items-center gap-3 pb-4">
        <Skeleton className="w-full flex-1 bg-surface-3 motion-reduce:animate-none" />
        <p className="text-sm text-text-muted">{message}</p>
      </div>
    </main>
  )
}

function WithMedia({ pieceId, detail, map, settings, setting }: { pieceId: string; detail: PieceDetail; map: PieceMap; settings: UserSettings; setting: PracticeSetting }) {
  const media = usePracticeMedia(pieceId)
  if (media.status === 'loading') return <PracticeSkeleton back={setting.back} message={text.loading} />
  if (media.status === 'failed') {
    return (
      <PageColumn width="narrow">
        <BackLink to={setting.back.to}>{setting.back.label}</BackLink>
        <ErrorState
          title={text.loadErrorTitle}
          text={media.reason === 'no-recording' ? text.noRecording : text.recordingFailed}
        />
      </PageColumn>
    )
  }
  return <Workspace pieceId={pieceId} detail={detail} map={map} settings={settings} media={media} setting={setting} />
}

const NO_BARS: PageLayer['bars'] = []
const NO_RESTS: PageLayer['rests'] = []
const NO_STATES: ReadonlyMap<BarNumber, BarState> = new Map()
const noop = () => {}

function Workspace({ pieceId, detail, map, settings: loaded, media, setting }: { pieceId: string; detail: PieceDetail; map: PieceMap; settings: UserSettings; media: PracticeMedia; setting: PracticeSetting }) {
  const { player, synth, peaks } = media
  // A copy of the sample piece shows the credits its licence asks for, in the same line as /demo; an ordinary piece has none (null).
  const sampleCredits = detail.sampleCredits
  const loadCredits = useCallback(async () => sampleCredits ?? [], [sampleCredits])
  // The settings shown are the session's, so a change made in the Playback panel (and saved at once) applies on the spot.
  const session = useSession()
  const { settings, change, failedIn } = useSettingsSaver<'playback'>(session.profile?.settings ?? loaded, session.saveSettings)
  const changePlayback = (update: Partial<PlaybackSettings>) =>
    change('playback', (current) => ({ ...current, playback: { ...current.playback, ...update } }))
  const [params, setParams] = useSearchParams()
  const parts = detail.parts.map((part) => ({ id: part.id, name: part.name }))
  const partId = parts.find((part) => part.id === params.get('part'))?.id ?? parts[0].id
  const partName = parts.find((part) => part.id === partId)?.name ?? ''
  useRememberPart(pieceId, partId)
  const part = useMemo(() => map.pages.find((page) => page.partId === partId) ?? { partId, bars: NO_BARS, rests: NO_RESTS }, [map.pages, partId])
  const durationSec = player.getDuration() ?? detail.piece.recording?.durationSec ?? null

  const timeline = useMemo(() => buildTimeline(map.timing, durationSec ?? undefined), [map.timing, durationSec])
  // The labels the bars go by (p7 for a pickup with no number); the data and the address keep the internal numbers.
  const barNames = useBarNamesOf(map.timing.shortBars)
  // The count-in follows the part on the stand: the fermatas of the recording and this part's own rests.
  const marks = useMemo(() => listedMarks(map.timing, part), [map.timing, part])
  const [state, controls] = usePractice({
    player,
    synth,
    timeline,
    marks,
    pieceId,
    initialCountInBars: map.piece.countInBars,
    initialMemory: map.piece.practice,
    countInFade: settings.playback.countInFade,
  })
  const { pages, failed: pagesFailed, retry: retryPages } = usePartPages(pieceId, partId)
  const phone = usePhoneLayout()
  const [hidden, setHidden] = useState(false)
  // On a phone the controls that fold start folded, so the score has the screen; a window that is not a phone keeps its own state.
  const [phoneOpen, setPhoneOpen] = useState(false)
  const collapsed = phone ? !phoneOpen : hidden
  // The score's zoom: 1 fits the width; two fingers change it on a phone or an iPad, and Fit brings it back.
  const [zoom, setZoom] = useState(1)
  useNoPageZoom()

  // Opens on the bar named in the address (an unknown bar is ignored): the score scrolls to it and the playhead sits on
  // it, ready to play, with nothing playing.
  const [opened] = useState<BarFocus | null>(() => {
    const bar = barFromParam(params.get('bar'), part.bars)
    return bar === null ? null : { bar }
  })
  useEffect(() => {
    if (opened === null) return
    const position = positionNearTime(timeline, opened.bar, 0)
    if (position !== null) player.seek(timeline[position].startSec)
    // Once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getTimeSec = useCallback(() => player.getTime(), [player])
  // The picker reads the loop at the moment of a long press, from the latest render.
  const loopRef = useRef({ range: state.range, looping: state.looping })
  useLayoutEffect(() => {
    loopRef.current = { range: state.range, looping: state.looping }
  })
  const getLoop = useCallback(() => loopRef.current, [])
  const picking = usePicking({ timeline, bars: part.bars, getTimeSec, getLoop, controls, playing: state.phase === 'playing' || state.phase === 'counting' })
  const edges = useRangeEdges({ range: state.range, timeline, bars: part.bars, pages: pages ?? [], onChange: controls.setRange })

  // The cursor's time, for the gliding line: it is read by the layers themselves, so the score is not redrawn per frame.
  const [clock] = useState(() => createFollowClock(state.timeSec + CURSOR_SLACK_SEC))
  useLayoutEffect(() => clock.set(state.timeSec + CURSOR_SLACK_SEC))

  // The count of a count-in, shown on the score above the start of the bar counted into (the count-in menu). It rides on
  // a clock of its own too, so a beat redraws only the label. 0 = no count.
  const { showCount } = settings.playback
  const [countClock] = useState(() => createFollowClock(0))
  useLayoutEffect(() => countClock.set(showCount ? (state.count?.beat ?? 0) : 0))
  // The bar counted into: the loop's first bar, or with no loop the bar a count-in before Play leads to.
  const countPosition = state.countAt ?? state.range?.startPosition ?? null
  const countSpot = useMemo(
    () => (countPosition === null ? null : countLabelSpot(timeline, part, countPosition)),
    [timeline, part, countPosition],
  )

  // Looping off means no marks: the range stays in the field and in the memory, but the tint, the handles and the band
  // on the strip are drawn only while it loops.
  const shown = state.looping ? state.range : null
  const overlay = useCallback(
    (pageIndex: number, scale: number): ReactNode => (
      <>
        <RangeLayer
          pageIndex={pageIndex}
          scale={scale}
          bars={part.bars}
          timeline={timeline}
          range={shown}
          pending={picking.pending}
          toggle={picking.toggle}
          clock={clock}
          edges={edges}
          showTint={settings.loop.show}
          onChoose={picking.choose}
        />
        <FollowLayer clock={clock} pageIndex={pageIndex} scale={scale} page={part} timeline={timeline} follow={settings.follow} />
        <CountLabel clock={countClock} pageIndex={pageIndex} scale={scale} spot={countSpot} colour={settings.follow.lineColour} />
      </>
    ),
    [part, timeline, shown, picking.pending, picking.toggle, picking.choose, edges, clock, countClock, countSpot, settings.follow, settings.loop.show],
  )

  const choosePart = (id: string) => {
    picking.cancel()
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('part', id)
        return next
      },
      { replace: true },
    )
  }

  const index = slotIndexAt(timeline, state.timeSec + CURSOR_SLACK_SEC)
  const scoreRef = useRef<HTMLDivElement>(null)
  // During a count-in that shows its count, the score goes to the bar counted into, where the count is, even when the
  // bar played before it is on the page before.
  const countingAtSec = showCount && state.phase === 'counting' && state.countAt !== null ? (timeline[state.countAt]?.startSec ?? null) : null
  const scrollTo = useFollowScroll({
    scroll: settings.follow.scroll,
    target: followTarget(timeline, part, countingAtSec ?? state.timeSec + CURSOR_SLACK_SEC),
    barIndex: index,
    playing: state.phase === 'playing' || state.phase === 'counting',
    containerRef: scoreRef,
  })
  usePracticeKeys(controls)
  const currentBar = index === -1 ? null : timeline[index].slot.bar
  const editHref = `/pieces/${pieceId}/edit?part=${partId}${currentBar === null ? '' : `&bar=${currentBar}`}`
  const canEdit = setting.editable && can(detail.piece.role, 'edit')
  const loop = shown === null ? null : loopTimes(timeline, shown)
  const strip =
    durationSec === null ? null : (
      <OverviewStrip
        peaks={peaks}
        durationSec={durationSec}
        timeSec={state.timeSec}
        loop={loop}
        loopLabel={shown === null ? null : rangeLabel(timeline, shown, barNames)}
        showFill={settings.loop.show}
        onSeek={(sec) => player.seek(sec)}
      />
    )

  return (
    <BarNamesProvider names={barNames}>
    <main className={phone ? 'mx-auto flex h-dvh w-full touch-pan-x touch-pan-y flex-col gap-2 px-2 pb-2' : 'mx-auto flex h-dvh w-full max-w-4xl touch-pan-x touch-pan-y flex-col gap-3 px-4 pb-4 lg:max-w-[1100px]'} style={loopVars(settings.loop.colour)}>
      <PracticeTopBar back={setting.back} title={detail.piece.title} partName={partName} practiceHref={`${setting.basePath}?part=${partId}`} editHref={canEdit ? editHref : null} />
      <div
        ref={scoreRef}
        data-slot="practice-score"
        className={cn('flex min-h-0 flex-1 flex-col [-webkit-touch-callout:none]', settings.nightScore && NIGHT_SCORE_CLASS, zoom !== 1 && 'relative')}
        onContextMenu={(event) => event.preventDefault()}
      >
        {pages === undefined ? (
          <ScoreLoading failed={pagesFailed} onRetry={retryPages} />
        ) : (
          <PracticeScore key={partId} pages={pages} page={part} showBarNumbers={settings.barNumbers} overlay={overlay} hint={picking.hint} focus={opened} scrollTo={scrollTo} onPointer={picking.onPointer} zoom={zoom} onPinchZoom={setZoom} />
        )}
        {zoom !== 1 && (
          <button
            type="button"
            aria-label={text.fitScore}
            onClick={() => setZoom(1)}
            className="absolute end-2 top-2 z-10 inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm font-semibold text-text shadow-md outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {text.fit}
          </button>
        )}
      </div>
      {!phone && !collapsed && strip}
      <PracticeToolbar
        state={state}
        controls={controls}
        timeline={timeline}
        currentBar={currentBar}
        durationSec={durationSec}
        parts={parts}
        partId={partId}
        onPartChange={choosePart}
        collapsed={collapsed}
        onCollapsedChange={(next) => (phone ? setPhoneOpen(!next) : setHidden(next))}
        onRangeChange={controls.setRange}
        playback={settings.playback}
        onPlaybackChange={changePlayback}
        playbackFailed={failedIn === 'playback'}
        strip={phone ? strip : undefined}
      />
      {setting.footer ?? (sampleCredits === null || sampleCredits.length === 0 ? null : <DemoCredits load={loadCredits} />)}
    </main>
    </BarNamesProvider>
  )
}

/** The score: it changes with the loop and the picking, not with every frame of the music, so a frame does not redraw the pages. */
const PracticeScore = memo(function PracticeScore({
  pages,
  page,
  showBarNumbers,
  overlay,
  hint,
  focus,
  scrollTo,
  onPointer,
  zoom,
  onPinchZoom,
}: {
  pages: PageImage[]
  page: PageLayer
  showBarNumbers: boolean
  overlay: (pageIndex: number, scale: number) => ReactNode
  hint: string | undefined
  focus: BarFocus | null
  scrollTo: ScrollRequest | null
  onPointer: Parameters<typeof ScoreView>[0]['onPointer']
  zoom: number
  onPinchZoom(zoom: number): void
}) {
  return <ScoreView pages={pages} page={page} barStates={NO_STATES} showBarNumbers={showBarNumbers} zoom={zoom} onPinchZoom={onPinchZoom} currentPage={0} onPageInView={noop} focusBar={focus} scrollTo={scrollTo} onPointer={onPointer} overlay={overlay} showPageLabel={false} hint={hint} />
})

/** The score area while a part's page images load (or after they failed). */
function ScoreLoading({ failed, onRetry }: { failed: boolean; onRetry(): void }) {
  if (failed) {
    return (
      <ErrorState
        title={text.loadErrorTitle}
        text={text.loadErrorText}
        actions={
          <Button size="xl" onClick={onRetry}>
            <ActionIcon action="retry" />
            {strings.common.retry}
          </Button>
        }
      />
    )
  }
  return (
    <div role="status" aria-label={strings.common.loading} className="flex min-h-0 flex-1 flex-col items-center gap-3">
      <Skeleton className="w-full flex-1 bg-surface-3 motion-reduce:animate-none" />
      <p className="text-sm text-text-muted">{text.scoreLoading}</p>
    </div>
  )
}
