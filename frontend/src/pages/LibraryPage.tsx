import { Plus, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { DeletePieceDialog } from '@/components/hub/DeletePieceDialog'
import { LeavePieceDialog } from '@/components/hub/LeavePieceDialog'
import { RenamePieceDialog } from '@/components/hub/RenamePieceDialog'
import { ShareDialog } from '@/components/hub/ShareDialog'
import { HeldPieceCard } from '@/components/library/HeldPieceCard'
import { OwnerChips } from '@/components/library/OwnerChips'
import { PieceCard, type CardAction } from '@/components/library/PieceCard'
import { piecesMadeOf } from '@/components/library/piecesMade'
import { PlanUsage } from '@/components/library/PlanUsage'
import { ViewToggle } from '@/components/library/ViewToggle'
import { useSettingsSaver } from '@/components/settings/useSettingsSaver'
import { PageColumn } from '@/components/shell/PageColumn'
import { EmptyState, ErrorState, LoadingState } from '@/components/shell/StateCards'
import { TopBar } from '@/components/shell/TopBar'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { filterPieces, pieceState, type StateFilter } from '@/domain/pieceStatus'
import { filterShared, ownerChips } from '@/domain/sharedPieces'
import { useClients } from '@/lib/clients'
import { DEFAULT_SETTINGS, type HeldPiece, type LibraryView, type PieceSummary } from '@/lib/dataClient'
import { usePlan, usePlanGate } from '@/lib/plan'
import { useSession } from '@/lib/session'
import { useFeatures } from '@/lib/useFeatures'
import { usePoll } from '@/lib/usePoll'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const POLL_MS = 1500

type Filter = 'all' | 'needs-review' | 'ready' | 'shared'
const FILTERS: readonly Filter[] = ['all', 'needs-review', 'ready', 'shared']

// What each state filter asks of the user's own pieces; All and Shared with me do not narrow by state.
const STATE_OF: Record<Filter, StateFilter> = { all: null, 'needs-review': 'needs-review', ready: 'ready', shared: null }

// buttonVariants on a link keeps the base text-sm and font-medium beside the size's text-base and font-semibold, and the
// stylesheet picks the wrong ones; cn merges them so the size wins.
const newPieceClass = cn(buttonVariants({ size: 'xl' }))

// The four filters share the look of the board: a bordered 48 px button, the pressed one raised and brighter.
const filterClass =
  'h-12 px-[18px] text-[15px] border border-border text-text-soft aria-pressed:border-border-strong aria-pressed:bg-surface-2 aria-pressed:font-medium aria-pressed:text-foreground'

/**
 * The user's pieces as cards or rows (the choice is kept in their settings), with search and four filters: All, Needs
 * review, Ready to practice and Shared with me. All lists both sections; the two state filters narrow the user's own
 * pieces and hide the shared ones; Shared with me shows only those. Each card has a three-dot menu that opens the same
 * dialogs as the piece hub. While any piece is processing the list is loaded again every 1.5 seconds, so its card moves on
 * by itself. A shared piece the user is on hold for (its owner's piece is over its member limit) is in Shared with me as a
 * card that cannot be opened; if those cannot be read, the rest of the library still shows.
 */
export function LibraryPage() {
  const { data, processor } = useClients()
  const features = useFeatures()
  const { profile, saveSettings } = useSession()
  const { state: plan, refresh: refreshPlan } = usePlan()
  const gate = usePlanGate()
  const made = piecesMadeOf(plan)
  // The Cards / List choice is a setting like the others: shown at once, saved in the background, put back if the save fails.
  const { settings, change } = useSettingsSaver<'view'>(profile?.settings ?? DEFAULT_SETTINGS, saveSettings)
  const view = settings.libraryView
  const setView = (next: LibraryView) => change('view', (now) => ({ ...now, libraryView: next }))
  // The card menu's dialog; the piece is kept after the dialog closes so its words do not empty while it fades out.
  const [dialog, setDialog] = useState<{ action: CardAction; piece: Pick<PieceSummary, 'id' | 'title'> } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const openDialog = (action: CardAction, piece: Pick<PieceSummary, 'id' | 'title'>) => {
    setDialog({ action, piece })
    setDialogOpen(true)
  }
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null)
  const myId = useId()
  const sharedId = useId()
  const {
    value: loaded,
    error,
    reload,
  } = usePoll(
    async () => {
      const [list, held] = await Promise.all([data.listPieces(), data.listHeldPieces().catch((): HeldPiece[] => [])])
      return { list, held }
    },
    {
      intervalMs: POLL_MS,
      while: ({ list }) => list.some((piece) => pieceState(piece.job, piece.review, piece.pageCount) === 'processing'),
    },
  )
  // The sample piece is asked for once per visit, after the first list load: an account that has not been asked is given its copy
  // (or told there is no room). A ref guards it, since strict mode runs the effect twice. A failure is only warned about: the
  // library shows without the sample, and the next visit asks again.
  const sampleAsked = useRef(false)
  const listed = loaded !== undefined
  const sampleGivenAt = profile?.sampleGivenAt
  useEffect(() => {
    if (!listed || sampleGivenAt !== null || sampleAsked.current) return
    sampleAsked.current = true
    processor.claimSamplePiece().then(
      (claim) => {
        if (claim.status !== 'given') return
        reload()
        // The sample is one of the trial's pieces, so the usage line changes too.
        void refreshPlan()
      },
      (reason: unknown) => console.warn('The sample piece could not be added:', reason),
    )
  }, [listed, sampleGivenAt, processor, reload, refreshPlan])
  // After a failed poll the cards would only be stale (the polling has stopped), so the error replaces them.
  const pieces = error === undefined ? loaded?.list : undefined
  const held = error === undefined ? (loaded?.held ?? []) : []
  // A held piece is still one of the user's pieces: it counts, and it keeps the page from being empty.
  const total = (pieces?.length ?? 0) + held.length
  // With no pieces the empty state is the whole page: it carries the New piece link, and a count of 0 would repeat it.
  const hasPieces = pieces !== undefined && total > 0

  // New piece is a link, so it still opens in a new tab; a click the plan refuses opens the prompt instead of the form.
  const newPieceLink = (children: ReactNode) => (
    <Link
      to="/pieces/new"
      className={newPieceClass}
      onClick={(event) => {
        if (!gate.check({ type: 'createPiece' })) event.preventDefault()
      }}
    >
      {children}
    </Link>
  )

  const showAll = () => {
    setQuery('')
    setFilter('all')
    setOwnerFilter(null)
  }

  const grid = (list: PieceSummary[]) => (
    <ul className={cn('grid grid-cols-1 gap-5', view === 'cards' && 'md:grid-cols-2 xl:grid-cols-3')}>
      {list.map((piece) => (
        <li key={piece.id} className="flex">
          <PieceCard piece={piece} view={view} onAction={(action) => openDialog(action, piece)} />
        </li>
      ))}
    </ul>
  )

  // The first section on screen carries the Cards / List switch at the end of its heading.
  const sectionHeading = (id: string, title: string, withSwitch: boolean) => (
    <div className="flex items-center justify-between gap-4">
      <h2 id={id} className="text-lg leading-[1.3] font-semibold">
        {title}
      </h2>
      {withSwitch && <ViewToggle value={view} onChange={setView} />}
    </div>
  )

  let body
  if (error !== undefined) {
    body = (
      <ErrorState
        title={strings.library.errorTitle}
        text={strings.library.errorText}
        actions={
          <Button size="xl" onClick={reload}>
            <ActionIcon action="retry" />
            {strings.common.retry}
          </Button>
        }
      />
    )
  } else if (pieces === undefined) {
    body = <LoadingState message={strings.library.loading} />
  } else if (total === 0) {
    body = (
      <EmptyState
        title={strings.library.emptyTitle}
        text={strings.library.emptyText}
        action={
          newPieceLink(
            <>
              <ActionIcon action="add" />
              {strings.library.newPiece}
            </>,
          )
        }
      />
    )
  } else {
    const mine = pieces.filter((piece) => piece.role === 'owner')
    const shared = pieces.filter((piece) => piece.role === 'viewer')
    // A held piece's owner gets a chip like any other.
    const chips = ownerChips([...shared, ...held])
    // A chip whose last piece was left must not leave an empty list with no way back.
    const owner = ownerFilter !== null && chips.includes(ownerFilter) ? ownerFilter : null
    // Shared with me shows only the shared pieces; the two state filters only the user's own (a member's piece has no review state).
    const visibleMine = filter === 'shared' ? [] : filterPieces(mine, { query, state: STATE_OF[filter] })
    const visibleShared = filter === 'all' || filter === 'shared' ? filterShared(shared, { query, owner }) : []
    const visibleHeld = filter === 'all' || filter === 'shared' ? filterShared(held, { query, owner }) : []
    const sharedCount = visibleShared.length + visibleHeld.length
    body = (
      <>
        <div role="search" className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1 basis-60">
            <label htmlFor={searchId} className="sr-only">
              {strings.library.searchLabel}
            </label>
            <Search
              className="pointer-events-none absolute start-4 top-1/2 size-[18px] -translate-y-1/2 text-text-muted"
              strokeWidth={2}
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="text"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={strings.library.searchPlaceholder}
              className="h-12 border-border bg-surface ps-11 pe-4 text-base md:text-base dark:bg-surface"
            />
          </div>
          <ToggleGroup
            aria-label={strings.library.filterLabel}
            spacing={3}
            className="flex-wrap"
            value={[filter]}
            onValueChange={(next) => {
              // A single choice: pressing the pressed filter again gives an empty list, which keeps the current one.
              const [picked] = next
              const chosen = FILTERS.find((candidate) => candidate === picked)
              if (chosen !== undefined) setFilter(chosen)
            }}
          >
            <ToggleGroupItem value="all" className={filterClass}>
              {strings.library.filterAll}
            </ToggleGroupItem>
            <ToggleGroupItem value="needs-review" className={filterClass}>
              {strings.library.filterNeedsReview}
            </ToggleGroupItem>
            <ToggleGroupItem value="ready" className={filterClass}>
              {strings.library.filterReady}
            </ToggleGroupItem>
            <ToggleGroupItem value="shared" className={filterClass}>
              {strings.library.filterShared}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {visibleMine.length + sharedCount === 0 ? (
          filter === 'shared' && shared.length + held.length === 0 ? (
            <EmptyState title={strings.library.sharedWithMe} text={strings.library.sharedEmptyText} />
          ) : (
            <EmptyState
              title={strings.library.noMatchTitle}
              text={strings.library.noMatchText}
              action={
                <Button size="xl" variant="outline" onClick={showAll}>
                  {strings.library.showAll}
                </Button>
              }
            />
          )
        ) : (
          <>
            {visibleMine.length > 0 && (
              <section aria-labelledby={myId} className="flex flex-col gap-4">
                {sectionHeading(myId, strings.library.myPieces, true)}
                {grid(visibleMine)}
              </section>
            )}
            {sharedCount > 0 && (
              <section aria-labelledby={sharedId} className="flex flex-col gap-4">
                {sectionHeading(sharedId, strings.library.sharedWithMe, visibleMine.length === 0)}
                {chips.length > 0 && <OwnerChips owners={chips} value={owner} onChange={setOwnerFilter} />}
                {visibleShared.length > 0 && grid(visibleShared)}
                {/* After the pieces that open: the held ones cannot be opened until their owners make room. */}
                {visibleHeld.length > 0 && (
                  <ul className={cn('grid grid-cols-1 gap-5', view === 'cards' && 'md:grid-cols-2 xl:grid-cols-3')}>
                    {visibleHeld.map((piece) => (
                      <li key={piece.id} className="flex">
                        <HeldPieceCard piece={piece} view={view} onLeave={() => openDialog('leave', piece)} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </>
    )
  }

  return (
    <PageColumn>
      <TopBar />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl leading-[1.3] font-bold tracking-[-0.01em]">{strings.library.title}</h1>
          {hasPieces && <p className="mt-1 text-[15px] text-text-muted">{strings.library.pieceCount(total)}</p>}
        </div>
        {(hasPieces || made !== null) && (
          <div className="flex flex-col items-end gap-2">
            {hasPieces &&
              newPieceLink(
                <>
                  <Plus className="size-[18px]" strokeWidth={2.4} data-icon="inline-start" aria-hidden="true" />
                  {strings.library.newPiece}
                </>,
              )}
            <PlanUsage state={plan} />
          </div>
        )}
      </div>
      {body}
      {dialog !== null && (
        <>
          <RenamePieceDialog
            open={dialogOpen && dialog.action === 'rename'}
            onOpenChange={setDialogOpen}
            title={dialog.piece.title}
            suggest={features.suggestName ? () => processor.suggestPieceName(dialog.piece.id) : undefined}
            onRename={async (title) => {
              await data.renamePiece(dialog.piece.id, title)
              reload()
            }}
          />
          <ShareDialog pieceId={dialog.piece.id} open={dialogOpen && dialog.action === 'share'} onOpenChange={setDialogOpen} />
          <DeletePieceDialog
            open={dialogOpen && dialog.action === 'delete'}
            onOpenChange={setDialogOpen}
            title={dialog.piece.title}
            note={made === null ? undefined : strings.plans.deleteNote(made.plan, made.used, made.max)}
            onDelete={async () => {
              await data.deletePiece(dialog.piece.id)
              setDialogOpen(false)
              reload()
              // The pieces stored went down; the pieces made did not.
              void refreshPlan()
            }}
          />
          <LeavePieceDialog
            open={dialogOpen && dialog.action === 'leave'}
            onOpenChange={setDialogOpen}
            title={dialog.piece.title}
            onLeave={async () => {
              await data.leavePiece(dialog.piece.id)
              setDialogOpen(false)
              reload()
            }}
          />
        </>
      )}
    </PageColumn>
  )
}
