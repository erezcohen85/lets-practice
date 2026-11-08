import { LogOut, Pencil, Share2, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { MoreMenu, type MoreMenuItem } from '@/components/ui/more-menu'
import { can } from '@/domain/access'
import { formatDuration, memberPreparing, pieceState, type PieceState } from '@/domain/pieceStatus'
import { type LibraryView, type PieceSummary } from '@/lib/dataClient'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

// The colour role of each state's status line and dot: primary while it works, problem on failure, amber (the
// selected role) while bars wait to be checked, green (the anchor role) when it is ready.
const STATE_COLOURS: Record<PieceState, { text: string; dot: string }> = {
  processing: { text: 'text-primary-strong', dot: 'bg-primary-strong' },
  failed: { text: 'text-problem', dot: 'bg-problem' },
  'needs-review': { text: 'text-selected', dot: 'bg-selected' },
  ready: { text: 'text-anchor', dot: 'bg-anchor' },
}

function statusText(state: PieceState, piece: PieceSummary, percent: number): string {
  const { status } = strings.library
  switch (state) {
    case 'processing':
      return status.processing(percent)
    case 'failed':
      return status.failed
    case 'needs-review':
      return status.needsReview(piece.review.checked, piece.review.total)
    case 'ready':
      return status.ready
  }
}

/** What a card's three-dot menu asks the page to do; the page opens the matching dialog. */
export type CardAction = 'rename' | 'share' | 'delete' | 'leave'

/**
 * The menu of a card: an owner can Rename, Share and Delete; while the piece is processing only Rename (it cannot be shared
 * or deleted yet); a member can only Leave, which changes their own membership and nothing of the owner's.
 */
function menuItems(member: boolean, state: PieceState, onAction: (action: CardAction) => void): MoreMenuItem[] {
  const { library } = strings
  if (member) return [{ label: library.menuLeave, icon: LogOut, onSelect: () => onAction('leave') }]
  const rename: MoreMenuItem = { label: library.menuRename, icon: Pencil, onSelect: () => onAction('rename') }
  if (state === 'processing') return [rename]
  return [
    rename,
    { label: library.menuShare, icon: Share2, onSelect: () => onAction('share') },
    { label: library.menuDelete, icon: Trash2, danger: true, onSelect: () => onAction('delete') },
  ]
}

/**
 * One piece of the library, the whole card a link: to the processing screen while the piece is processing, to the
 * hub otherwise. A member's card (a piece shared with them) names who shared it, never shows review status, and always
 * opens the hub, which says "Being prepared" until the piece is ready. Parts have no colours; the card says how many
 * there are and how long the recording is. The three-dot menu sits beside the link, not inside it, so a click on it
 * never opens the piece. In the list view the card is one row: the title on one side, the status on the other.
 */
export function PieceCard({ piece, view = 'cards', onAction }: { piece: PieceSummary; view?: LibraryView; onAction: (action: CardAction) => void }) {
  const member = !can(piece.role, 'review')
  const state = pieceState(piece.job, piece.review, piece.pageCount)
  const percent = Math.round(Math.min(1, Math.max(0, piece.job?.progress ?? 0)) * 100)
  const colours = STATE_COLOURS[state]
  const to = !member && state === 'processing' ? `/pieces/${piece.id}/processing` : `/pieces/${piece.id}`
  const list = view === 'list'
  return (
    <div className="relative flex min-w-0 flex-1" data-view={view}>
      <Link
        to={to}
        className={cn(
          'flex min-w-0 flex-1 gap-4 rounded-card border border-border bg-surface p-5 outline-none transition-colors hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          list ? 'min-h-[84px] flex-col justify-center pe-16 sm:flex-row sm:items-center sm:justify-between' : 'min-h-[188px] flex-col',
        )}
      >
        <div className={cn(list ? 'min-w-0 sm:flex-1' : 'flex-1')}>
          {/* Room on the right for the menu button, so a long title never runs under it. */}
          <div className={cn('text-xl leading-[1.2] font-semibold break-words', !list && 'pe-10')}>
            {piece.title}
            {piece.isSample && <span className="ms-2 align-middle text-sm leading-[1.3] font-normal text-text-muted">{strings.library.sampleLabel}</span>}
          </div>
          <div className="mt-1 text-sm leading-[1.3] text-text-muted">
            {strings.library.cardSubtitle(piece.partCount, formatDuration(piece.durationSec))}
          </div>
          {member && piece.ownerName !== null && (
            <div className="mt-1 text-sm leading-[1.3] text-text-soft">{strings.library.sharedBy(piece.ownerName)}</div>
          )}
        </div>
        <div className={cn('flex flex-col gap-2', list && 'sm:w-60 sm:shrink-0')}>
          {member ? (
            memberPreparing(piece.job) && (
              <div className="flex items-center gap-2 text-sm leading-[1.3] font-medium text-primary-strong">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary-strong" />
                {strings.library.beingPrepared}
              </div>
            )
          ) : (
            <div className={cn('flex items-center gap-2 text-sm leading-[1.3] font-medium', colours.text)}>
              <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', colours.dot)} />
              {statusText(state, piece, percent)}
            </div>
          )}
          {!member && state === 'processing' && (
            <div
              role="progressbar"
              aria-label={strings.library.progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-1.5 rounded-[3px] bg-surface-3"
            >
              <div className="h-full rounded-[3px] bg-primary-strong" style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
      </Link>
      <MoreMenu
        label={strings.library.moreFor(piece.title)}
        items={menuItems(member, state, onAction)}
        className={cn('absolute end-2.5', list ? 'top-2.5 sm:top-5' : 'top-2.5')}
      />
    </div>
  )
}
