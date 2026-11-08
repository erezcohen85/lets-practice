import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { EditorStatus } from '@/components/editor/EditorStatus'
import { EditorTopBar } from '@/components/editor/EditorTopBar'
import { EditSheet } from '@/components/editor/EditSheet'
import { PieceChangeConfirm, type PendingPieceChange } from '@/components/editor/PieceChangeConfirm'
import { usePieceEditing } from '@/components/editor/usePieceEditing'
import { IpadNotice } from '@/components/editor/IpadNotice'
import { BiggerScreenPage } from '@/components/editor/BiggerScreenPage'
import { useEditorBlocked } from '@/components/editor/useEditorBlocked'
import { useBarLineMode } from '@/components/editor/useBarLineMode'
import { useBarArrowKeys } from '@/components/editor/useBarArrowKeys'
import { useBarClicks } from '@/components/editor/useBarClicks'
import { usePaneSizes } from '@/components/editor/usePaneSizes'
import { usePartPages } from '@/components/editor/usePartPages'
import { useEditorFollowScroll } from '@/components/editor/useEditorFollowScroll'
import { useFillEmpty } from '@/components/editor/useFillEmpty'
import { usePulseRegrid } from '@/components/editor/usePulseRegrid'
import { useRealign } from '@/components/editor/useRealign'
import { useShiftNote } from '@/components/editor/useShiftNote'
import { useScoreEditing } from '@/components/editor/useScoreEditing'
import { createFollowClock } from '@/components/practice/followClock'
import { FollowLayer } from '@/components/practice/FollowLayer'
import { EditHint, ScoreView, type BarFocus, type BarState } from '@/components/score/ScoreView'
import { useScoreZoom, zoomKeyDirection } from '@/components/score/useScoreZoom'
import { BackLink } from '@/components/shell/BackLink'
import { PageColumn } from '@/components/shell/PageColumn'
import { Splitter } from '@/components/shell/Splitter'
import { ErrorState } from '@/components/shell/StateCards'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StructurePanel, type StructureSection } from '@/components/structure/StructurePanel'
import { ReviewQueue } from '@/components/review/ReviewQueue'
import { EditorDock, type SeekRequest } from '@/components/waveform/EditorDock'
import { type SlotRef } from '@/components/waveform/WaveformDock'
import { boxGroup, setBarsInBox, setBarsInBoxInPiece } from '@/domain/boxEdits'
import { togglePickup } from '@/domain/pickup'
import { type StepKind } from '@/domain/history'
import { type EditResult, type EditorDoc, partProblems, slotAfterEdit } from '@/domain/pieceEdits'
import { barCountAdvice } from '@/domain/pieceImpact'
import { type ReviewItem } from '@/domain/reviewQueue'
import { formatOffset } from '@/domain/barLabel'
import { neighbourBar } from '@/domain/barNavigation'
import { barFromParam, locatorNearPlayhead, locatorOfBar, nextPass } from '@/domain/linkedSelection'
import { unmatchedSlots } from '@/domain/renumber'
import { buildTimeline } from '@/domain/tempo'
import { filledSlots } from '@/domain/fillBars'
import { movedOffsets } from '@/domain/timingEdits'
import { can } from '@/domain/access'
import { pagesOf, pieceState } from '@/domain/pieceStatus'
import { type BarNumber, type PageLayer, type PieceMap } from '@/domain/types'
import { cn } from '@/lib/utils'
import { useClients } from '@/lib/clients'
import { useFeatures } from '@/lib/useFeatures'
import { useSession } from '@/lib/session'
import { useRememberPart } from '@/lib/useRememberPart'
import { DEFAULT_SETTINGS, type PieceDetail } from '@/lib/dataClient'
import { useBeatsRead } from '@/lib/useBeats'
import { useEditorDoc, type EditorDocApi } from '@/lib/useEditorDoc'
import { BarNamesProvider } from '@/lib/BarNamesProvider'
import { useBarNamesOf } from '@/lib/barNamesContext'
import { usePoll } from '@/lib/usePoll'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { strings } from '@/strings'

const text = strings.editor

/** The Structure edits: after one of these the recording times may no longer fit the bars, until the next realign. (edit-marks is one only when it changes a fermata or rit.: a part's rests do not move the times.) */
const STRUCTURE_STEPS: ReadonlySet<StepKind> = new Set([
  'insert-piece-bar',
  'remove-piece-bar',
  'add-piece-bar-line',
  'delete-piece-bar-line',
  'set-piece-bars-in-box',
  'edit-meters',
  'edit-play-order',
  'edit-short-bars',
  'toggle-pickup',
  'add-pickup-bar',
  'remove-pickup-bar',
  'set-pickup-length',
])
/** The edits that change the piece's number of bars: each asks "This changes the whole piece" first (Decisions 2026-11-03). */
const PIECE_COUNT_STEPS: ReadonlySet<StepKind> = new Set([
  'insert-piece-bar',
  'remove-piece-bar',
  'add-piece-bar-line',
  'delete-piece-bar-line',
  'set-piece-bars-in-box',
  'toggle-pickup',
])

type Loaded =
  | { status: 'missing' }
  | { status: 'member' }
  | { status: 'processing' }
  | { status: 'ready'; detail: PieceDetail; map: PieceMap }

/** The Editor: one workspace for the piece, with the score of one part at a time (`?part=`). */
export function EditorPage() {
  const { pieceId } = useParams()
  if (pieceId === undefined) return <NotFoundPage />
  // Keyed, so the Editor opened for another piece starts again, with its own history.
  return <Editor key={pieceId} pieceId={pieceId} />
}

function Editor({ pieceId }: { pieceId: string }) {
  const { data } = useClients()
  const blocked = useEditorBlocked()
  const [params] = useSearchParams()
  // Loaded once: the editor then holds the document. A piece still processing has empty layers, so its status is read first.
  const { value, error, reload } = usePoll<Loaded>(
    async () => {
      const detail = await data.getPiece(pieceId)
      if (detail === null) return { status: 'missing' }
      // A member has no editor: this is decided before the map is read and before any editor hook (which saves) exists.
      if (!can(detail.piece.role, 'edit')) return { status: 'member' }
      if (pieceState(detail.job, detail.review, pagesOf(detail)) === 'processing') return { status: 'processing' }
      const map = await data.getPieceMap(pieceId)
      return map === null || detail.parts.length === 0 ? { status: 'missing' } : { status: 'ready', detail, map }
    },
    { intervalMs: 1000, while: () => false },
  )

  if (error !== undefined) {
    return (
      <PageColumn width="narrow">
        <BackLink to={`/pieces/${pieceId}`}>{text.pieceHub}</BackLink>
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
  if (value === undefined) return <EditorSkeleton pieceId={pieceId} />
  if (value.status === 'missing') return <NotFoundPage />
  if (value.status === 'member') return <Navigate to={`/pieces/${pieceId}/practice`} replace />
  if (value.status === 'processing') return <Navigate to={`/pieces/${pieceId}/processing`} replace />
  // A phone has no editor (Decisions 2026-11-08). Checked while the page is open, so a screen that turns phone-sized gets
  // the message too; edits are saved as they are made, only the visit's undo history goes.
  if (blocked) return <BiggerScreenPage pieceId={pieceId} partId={value.detail.parts.find((part) => part.id === params.get('part'))?.id ?? value.detail.parts[0].id} />
  return <Workspace pieceId={pieceId} detail={value.detail} map={value.map} />
}

/** The Editor before the piece has loaded: the way back and a pulsing page. */
function EditorSkeleton({ pieceId }: { pieceId: string }) {
  return (
    <main className="flex h-dvh flex-col gap-4 p-6">
      <div>
        <BackLink to={`/pieces/${pieceId}`}>{text.pieceHub}</BackLink>
      </div>
      <div role="status" aria-label={strings.common.loading} className="flex min-h-0 flex-1 flex-col items-center gap-3">
        <Skeleton className="h-4 w-48 bg-surface-3 motion-reduce:animate-none" />
        <Skeleton className="w-full max-w-3xl flex-1 bg-surface-3 motion-reduce:animate-none" />
        <p className="text-sm text-text-muted">{text.loading}</p>
      </div>
    </main>
  )
}

const NO_BARS: PageLayer['bars'] = []
const NO_RESTS: PageLayer['rests'] = []
/** The follow box is drawn this many screen pixels inside the bar box, so it shows inside the selection's outline on the same bar. */
const FOLLOW_INSET_PX = 3

function Workspace({ pieceId, detail, map }: { pieceId: string; detail: PieceDetail; map: PieceMap }) {
  const { data } = useClients()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  // The names parts were given here since the editor opened: renaming does not reload the editor (and its history).
  const [renamed, setRenamed] = useState<Record<string, string>>({})
  const parts = detail.parts.map((part) => ({ id: part.id, name: renamed[part.id] ?? part.name }))
  const partId = parts.find((part) => part.id === params.get('part'))?.id ?? parts[0].id
  const partName = parts.find((part) => part.id === partId)?.name ?? ''
  useRememberPart(pieceId, partId)

  const [initial] = useState<EditorDoc>(() => ({ timing: map.timing, pages: map.pages, structureSetAt: map.structureSetAt ?? null, ...(detail.piece.recording?.durationSec == null ? {} : { recordingSec: detail.piece.recording.durationSec }) }))
  const editor = useEditorDoc(pieceId, initial)
  const { barLineMode, setBarLineMode, saveFailed } = useBarLineMode()
  const zoom = useScoreZoom()
  const sizes = usePaneSizes()
  const { pages, failed: pagesFailed, retry: retryPages } = usePartPages(pieceId, partId)
  const [viewPage, setViewPage] = useState<{ partId: string; index: number }>({ partId, index: 0 })
  // The one selection of the page (view state, never recorded): a bar of the score and, when it has a locator, that
  // locator on the waveform. It opens on the bar named by ?bar= (an unknown bar is ignored). The score scrolls to a
  // bar that was picked elsewhere than on the score (`focus`); the queue also asks the playhead to move (`seekTo`).
  const [opened] = useState(() => {
    const bar = barFromParam(params.get('bar'), map.pages.find((layer) => layer.partId === partId)?.bars ?? NO_BARS)
    if (bar === null) return null
    const slot = locatorOfBar(map.timing.locators, bar, null)
    return { selection: { bar, passIndex: slot?.passIndex ?? null }, focus: { bar } }
  })
  const [selection, setSelection] = useState<{ bar: BarNumber; passIndex: number | null } | null>(opened?.selection ?? null)
  const [focus, setFocus] = useState<BarFocus | null>(opened?.focus ?? null)
  // Locators chosen together on the waveform (Shift + click, Shift + drag on its label row). Empty or one long: the selection is the one above.
  const [group, setGroup] = useState<SlotRef[]>([])
  const [seekTo, setSeekTo] = useState<SeekRequest | null>(null)
  const playheadRef = useRef<number | null>(null)
  // The playhead's time for the follow box, which reads it itself, so a frame of the music does not redraw the editor.
  const [clock] = useState(() => createFollowClock(0))
  const [playing, setPlaying] = useState(false)
  const scoreRef = useRef<HTMLDivElement>(null)
  const [structure, setStructure] = useState<{ open: boolean; section: StructureSection }>({ open: false, section: 'bars' })
  // Open, Structure takes the dock's place at the height its section needs (`fit`, measured by the panel), between the
  // dock's height and the dock splitter's limit. The splitter then sizes the region instead of the dock (`dragged`, for
  // this section only); the dock's own height is not touched, so closing gives the dock back exactly as it was.
  const [fit, setFit] = useState<number | null>(null)
  const [dragged, setDragged] = useState<number | null>(null)
  const regionHeight = structure.open ? Math.min(sizes.dock.max, Math.max(sizes.dock.min, dragged ?? Math.max(sizes.dock.value, fit ?? 0))) : sizes.dock.value
  const showStructure = (open: boolean, section?: StructureSection) => {
    setDragged(null)
    setStructure((previous) => ({ open, section: section ?? previous.section }))
  }

  // Whether the structure changed since the last realign in this visit.
  const [structureChanged, setStructureChanged] = useState(false)

  // The labels the bars go by (p7 for a pickup with no number); every bar below is the internal number until it is shown.
  const barNames = useBarNamesOf(editor.doc.timing.shortBars)
  const shiftNote = useShiftNote(editor.doc.timing, barNames)
  const fill = useFillEmpty(pieceId, editor, () => setStructureChanged(false), shiftNote.afterFill)
  const pieceEditing = usePieceEditing()
  const [pending, setPending] = useState<PendingPieceChange | null>(null)
  // A change to the piece's number of bars waits for the confirm; everything else is applied at once.
  const apply = (result: EditResult) => {
    if (result.ok && PIECE_COUNT_STEPS.has(result.label.kind)) {
      setPending({ before: editor.doc, result })
      return null
    }
    return applyNow(result)
  }
  const applyNow = (result: EditResult) => {
    if (result.ok) {
      const { kind } = result.label
      // Only the timing's marks are compared: a part's rests move no recording time, so a rests-only edit needs no realign.
      const marksMoved = kind === 'edit-marks' && JSON.stringify(result.doc.timing.marks) !== JSON.stringify(editor.doc.timing.marks)
      if (STRUCTURE_STEPS.has(kind) || marksMoved) setStructureChanged(true)
    }
    const before = editor.doc
    const refusal = editor.apply(result)
    // A new play order renames the passes of a bar, and a regrid's ripple moves the later bars to other numbers: the selection follows its
    // locator (by its time), or loses the locator when it went. The lines a regrid starts and ends at never move.
    if (refusal === null && result.ok && (result.label.kind === 'edit-play-order' || result.label.kind === 'add-pickup-bar' || result.label.kind === 'regrid')) {
      if (selection !== null && selection.passIndex !== null) {
        const now = slotAfterEdit(before, result.doc, { bar: selection.bar, passIndex: selection.passIndex })
        setSelection(now ?? { bar: selection.bar, passIndex: null })
      }
      const followed = group.flatMap((slot) => slotAfterEdit(before, result.doc, slot) ?? [])
      setGroup(followed.length > 1 ? followed : [])
    }
    // The top pickup coming or going moves every bar one number: the selection stays on the same bar of the score.
    if (refusal === null && result.ok && result.label.kind === 'toggle-pickup' && selection !== null) {
      setSelection({ ...selection, bar: selection.bar + result.doc.timing.barCount - before.timing.barCount })
    }
    // Bars the edit left without a time are filled in at once (only those; nothing that has a time moves).
    if (refusal === null) {
      shiftNote.afterEdit(editor.doc.timing, result)
      fill.afterEdit(result)
    }
    return refusal
  }
  const tracked: EditorDocApi = { ...editor, apply }

  const editing = useScoreEditing(tracked, partId, pieceEditing.state.on ? barLineMode : null, partName, (index) => pages?.find((image) => image.pageIndex === index)?.width)
  const part = editor.doc.pages.find((page) => page.partId === partId) ?? { partId, bars: NO_BARS, rests: NO_RESTS }
  const selectedSlot: SlotRef | null = selection === null || selection.passIndex === null ? null : { bar: selection.bar, passIndex: selection.passIndex }
  const selectSlot = (slot: SlotRef) => {
    setSelection(slot)
    setGroup([])
    setFocus({ bar: slot.bar })
  }
  // The dock chose several locators or cleared the selection; the last one chosen is the one the score follows.
  const selectGroup = (slots: SlotRef[]) => {
    const last = slots.at(-1)
    setGroup(slots.length > 1 ? slots : [])
    setSelection(last ?? null)
    if (last !== undefined) setFocus({ bar: last.bar })
  }
  // A bar clicked on the score selects its locator of the pass nearest the playhead (the first with no playhead time)
  // and moves the playhead to it; a bar with no locator is only selected. A double click (`again`) goes on to the next pass of
  // the bar in playing order instead (the 1st, 2nd, 1st), from the pass that is selected.
  const pickBar = (bar: BarNumber, again = false) => {
    const locator = again
      ? nextPass(editor.doc.timing.locators, bar, selection?.bar === bar ? selection.passIndex : null)
      : locatorNearPlayhead(editor.doc.timing.locators, bar, playheadRef.current)
    setSelection({ bar, passIndex: locator?.passIndex ?? null })
    setGroup([])
    if (locator !== null) setSeekTo({ timeSec: locator.timeSec })
  }
  const barClicks = useBarClicks(part.bars, editing.mode, pickBar)
  // The arrow keys pick a bar as a click would, and the score scrolls to it (or turns the page) when it is out of view.
  useBarArrowKeys((step) => {
    const bar = neighbourBar(part.bars, selection?.bar ?? null, step)
    if (bar === null) return
    pickBar(bar)
    setFocus({ bar })
  })
  // The follow box and scroll use the timing as it is now: a moved locator or a realign changes where the box goes at once.
  const recordingSec = detail.piece.recording?.durationSec ?? undefined
  const timeline = useMemo(() => buildTimeline(editor.doc.timing, recordingSec), [editor.doc.timing, recordingSec])
  const session = useSession()
  const follow = session.profile?.settings.follow ?? DEFAULT_SETTINGS.follow
  const scrollTo = useEditorFollowScroll({ clock, timeline, page: part, scroll: follow.scroll, playing, containerRef: scoreRef })
  // The follow box under the editing overlay (the hover line and handle), both over the page; neither takes the pointer.
  const scoreOverlay = (pageIndex: number, scale: number) => (
    <>
      <FollowLayer clock={clock} pageIndex={pageIndex} scale={scale} page={part} timeline={timeline} follow={follow} inset={FOLLOW_INSET_PX} />
      {editing.overlay(pageIndex, scale)}
    </>
  )
  const features = useFeatures()
  const realign = useRealign(pieceId, editor, () => setStructureChanged(false))
  // The beats are read here once: the dock draws them, and the Wrong beat card (and the automatic re-grid) put the bar lines on them.
  const { beats, loaded: beatsLoaded } = useBeatsRead(pieceId)
  const pulse = usePulseRegrid({
    doc: editor.doc,
    beats,
    beatsLoaded,
    durationSec: recordingSec,
    apply,
    auto: session.profile?.settings.autoRegrid ?? DEFAULT_SETTINGS.autoRegrid,
    ready: !fill.filling,
    notify: editing.showText,
  })

  const { zoomIn, zoomOut } = zoom
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction = zoomKeyDirection(event)
      if (direction > 0) zoomIn()
      else if (direction < 0) zoomOut()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomIn, zoomOut])

  const unmatched = unmatchedSlots(editor.doc.timing)
  // The part's rests are drawn faintly in the Editor (not in Practice); every other state draws over them.
  const barStates = new Map<BarNumber, BarState>(part.rests.map((bar) => [bar, 'rest']))
  for (const slot of unmatched) barStates.set(slot.bar, 'unmatched')
  // The bars whose lines were dragged by hand and are not resolved yet, with how far each moved.
  const moved = movedOffsets(editor.doc)
  const barTags = new Map<BarNumber, string>()
  for (const { bar, deltaSec } of moved) {
    barStates.set(bar, 'moved')
    barTags.set(bar, strings.score.movedTag(barNames.label(bar), formatOffset(deltaSec)))
  }
  // A moved bar keeps its moved tint while selected (dragging a line selects it); the overlay draws the amber outline over it.
  if (selection !== null && barStates.get(selection.bar) !== 'moved') barStates.set(selection.bar, 'selected')
  // The other chosen locators show on the score the same way.
  for (const { bar } of group) if (barStates.get(bar) !== 'moved') barStates.set(bar, 'selected')

  const problem = partProblems(editor.doc, partId)[0]
  const inView = viewPage.partId === partId ? viewPage.index : 0
  const firstBar = Math.min(...part.bars.filter((box) => box.pageIndex === inView).map((box) => box.bar))
  const practiceBar = selection?.bar ?? (Number.isFinite(firstBar) ? firstBar : null)
  const practiceHref = `/pieces/${pieceId}/practice?part=${partId}${practiceBar === null ? '' : `&bar=${practiceBar}`}`

  // A Review Queue card was opened: select its slot and bar (the score follows to its page) and move the playhead to its time.
  const focusItem = (item: ReviewItem) => {
    if (item.kind === 'part') return
    selectSlot({ bar: item.bar, passIndex: item.kind === 'box' ? 0 : item.passIndex })
    if (item.kind === 'flag') setSeekTo({ timeSec: item.timeSec })
    else if (item.kind === 'box') {
      // A box flag has no time of its own: the playhead goes to the bar's locator. A bar without one (and an unmatched card) has no time, so it stays.
      const locator = locatorNearPlayhead(editor.doc.timing.locators, item.bar, null)
      if (locator !== null) setSeekTo({ timeSec: locator.timeSec })
    }
  }

  // Bar boxes belong to a part: another part starts with no selection.
  const choosePart = (id: string) => {
    setSelection(null)
    setGroup([])
    setFocus(null)
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('part', id)
        return next
      },
      { replace: true },
    )
  }

  // Bars in this box, for the selected bar: this part only, or the piece too with Edit piece structure on.
  const selectedGroup = selection === null ? [] : boxGroup(part, selection.bar)
  const barsInBox =
    selection === null || selectedGroup.length === 0
      ? null
      : {
          count: selectedGroup.length,
          onChange: (count: number) => {
            const result = pieceEditing.state.on
              ? setBarsInBoxInPiece(editor.doc, partId, selection.bar, count, barLineMode)
              : setBarsInBox(editor.doc, partId, selection.bar, count)
            const reason = apply(result)
            if (reason !== null) editing.showRefusal(reason)
          },
        }
  // The Pickup bar switch, for the selected bar: a piece structure edit, so Edit piece must be on first.
  const pickupBar =
    selection === null
      ? null
      : {
          on: barNames.isUnnumbered(selection.bar),
          onToggle: () => {
            if (!pieceEditing.state.on) {
              pieceEditing.requestOn()
              return
            }
            const reason = apply(togglePickup(editor.doc, selection.bar))
            if (reason !== null) editing.showRefusal(reason)
          },
        }
  const hint = pieceEditing.state.turnedOffIdle ? strings.editor.pieceEditing.idleOff : editing.hint


  const openStructure = () => showStructure(true, 'partBars')

  const sheet = (
    <EditSheet
      mode={editing.mode}
      onModeChange={editing.setMode}
      undoLabel={editor.undoLabel}
      redoLabel={editor.redoLabel}
      onUndo={editor.undo}
      onRedo={editor.redo}
      pieceEditing={pieceEditing}
      partName={partName}
      barsInBox={barsInBox}
      pickupBar={pickupBar}
      zoomPercent={zoom.percent}
      onZoomIn={zoom.zoomIn}
      onZoomOut={zoom.zoomOut}
    />
  )
  const statusLine = (
    <EditorStatus
      saveState={editor.saveState}
      settingsFailed={saveFailed}
      partProblem={problem === undefined ? null : { name: partName, partBars: problem.partBars, pieceBars: problem.pieceBars, advice: barCountAdvice(editor.doc, partId) }}
      unmatchedCount={unmatched.length}
      movedCount={moved.length}
      structureChanged={structureChanged}
      realigning={realign.realigning}
      canRealign={features.realign}
      filling={fill.filling}
      noRoom={fill.noRoom}
      filledCount={filledSlots(editor.doc).length}
      shiftNote={shiftNote.sentence}
      realignError={realign.error}
      realignNote={realign.note}
      onRetry={editor.retrySave}
      onOpenStructure={openStructure}
      onRealign={realign.start}
      onEditPiece={pieceEditing.requestOn}
    />
  )

  return (
    <BarNamesProvider names={barNames}>
    <main
      onPointerDownCapture={pieceEditing.action}
      onKeyDownCapture={pieceEditing.action}
      // The page itself never scrolls (Erez, 2026-11-03): only the score and the Review Queue do, inside their regions.
      className="relative flex h-dvh flex-col overflow-hidden"
      style={{ '--queue-width': `${sizes.queue.value}px`, '--dock-height': `${sizes.dock.value}px`, '--region-height': `${regionHeight}px` } as React.CSSProperties}
    >
      <EditorTopBar
        pieceId={pieceId}
        title={detail.piece.title}
        parts={parts}
        partId={partId}
        onPartChange={choosePart}
        onRenamePart={async (name) => {
          await data.renamePart(pieceId, partId, name)
          setRenamed((names) => ({ ...names, [partId]: name }))
        }}
        onDeletePart={async () => {
          await data.deletePart(pieceId, partId)
          // The editor holds the document of every part, so it is left: the hub shows what is left of the piece.
          void navigate(`/pieces/${pieceId}`, { replace: true })
        }}
        practiceHref={practiceHref}
      />
      <div className="flex min-h-0 flex-1">
        <div ref={scoreRef} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-6">
          <IpadNotice />
          {pages === undefined ? (
            <ScoreLoading failed={pagesFailed} onRetry={retryPages} hint={hint} statusLine={statusLine} toolbar={sheet} />
          ) : (
            <ScoreView
              key={partId}
              pages={pages}
              page={part}
              barStates={barStates}
              barTags={barTags}
              selectedBar={selection?.bar ?? null}
              showBarNumbers={session.profile?.settings.barNumbers ?? DEFAULT_SETTINGS.barNumbers}
              zoom={zoom.percent / 100}
              currentPage={inView}
              focusBar={focus}
              scrollTo={scrollTo}
              onPageInView={(index) => setViewPage({ partId, index })}
              onPointer={(event) => {
                editing.onPointer(event)
                barClicks.onPointer(event)
              }}
              overlay={scoreOverlay}
              hint={hint}
              statusLine={statusLine}
              toolbar={sheet}
            />
          )}
        </div>
        <Splitter
          orientation="vertical"
          label={text.resizeQueue}
          value={sizes.queue.value}
          min={sizes.queue.min}
          max={sizes.queue.max}
          defaultValue={sizes.queue.default}
          onChange={sizes.queue.set}
          className="max-lg:hidden"
        />
        <ReviewQueue
          doc={editor.doc}
          partId={partId}
          partName={partName}
          selected={selectedSlot}
          onApply={apply}
          onFocusItem={focusItem}
          realigning={realign.realigning}
          canRealign={features.realign}
          onRealign={realign.start}
          onOpenStructure={openStructure}
          onNotice={editing.showText}
          onPulseRegrid={pulse.canRegrid ? pulse.regrid : undefined}
        />
      </div>
      <Splitter
        orientation="horizontal"
        label={text.resizeDock}
        value={regionHeight}
        min={sizes.dock.min}
        max={sizes.dock.max}
        defaultValue={structure.open ? Math.max(sizes.dock.value, fit ?? 0) : sizes.dock.default}
        onChange={structure.open ? setDragged : sizes.dock.set}
        className="max-lg:hidden"
      />
      {/* The strip stays between the score area and the dock; opened, its panel covers the dock region. */}
      <StructurePanel
        doc={editor.doc}
        parts={parts}
        partId={partId}
        barLineMode={barLineMode}
        open={structure.open}
        section={structure.section}
        onOpenChange={showStructure}
        onFit={setFit}
        onEdit={apply}
        busy={realign.realigning}
        pieceOn={pieceEditing.state.on}
        onRequestPieceOn={pieceEditing.requestOn}
        onRequestPieceOff={pieceEditing.turnOff}
        onBarLineModeChange={setBarLineMode}
      />
      {/* While Structure is open the dock is out of sight and reach, but stays mounted: its player keeps playing. */}
      <div data-slot="dock-region" inert={structure.open} className={cn('h-(--dock-height) shrink-0 overflow-y-auto max-lg:h-auto lg:h-(--region-height)', structure.open && 'invisible')}>
        <EditorDock
          pieceId={pieceId}
          partId={partId}
          doc={editor.doc}
          recordingSec={detail.piece.recording?.durationSec ?? null}
          selected={selectedSlot}
          onSelect={selectSlot}
          group={group}
          onSelectGroup={selectGroup}
          playheadRef={playheadRef}
          clock={clock}
          onPlayingChange={setPlaying}
          seekTo={seekTo}
          barLineMode={barLineMode}
          onBarLineModeChange={setBarLineMode}
          continueMode={session.profile?.settings.continueMode ?? DEFAULT_SETTINGS.continueMode}
          beats={beats}
          onApply={apply}
        />
      </div>
      <PieceChangeConfirm
        pending={pending}
        parts={parts}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending !== null) applyNow(pending.result)
          setPending(null)
        }}
      />
    </main>
    </BarNamesProvider>
  )
}

/** The score area while a part's page images load: the Edit sheet and the status line stay, the pages pulse (or say they failed). */
function ScoreLoading({ failed, onRetry, hint, statusLine, toolbar }: { failed: boolean; onRetry(): void; hint: string; statusLine: React.ReactNode; toolbar: React.ReactNode }) {
  return (
    <section aria-label={strings.score.region} className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-end gap-x-4">
        <EditHint hint={hint} />
        {statusLine}
      </div>
      {toolbar}
      {failed ? (
        <ErrorState
          title={text.loadErrorTitle}
          text={text.loadErrorText}
          actions={<Button size="xl" onClick={onRetry}><ActionIcon action="retry" />{strings.common.retry}</Button>}
        />
      ) : (
        <div role="status" aria-label={strings.common.loading} className="flex min-h-0 flex-1 flex-col items-center gap-3">
          <Skeleton className="w-full max-w-3xl flex-1 bg-surface-3 motion-reduce:animate-none" />
          <p className="text-sm text-text-muted">{text.scoreLoading}</p>
        </div>
      )}
    </section>
  )
}
