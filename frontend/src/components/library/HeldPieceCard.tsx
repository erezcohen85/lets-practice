import { CirclePause, LogOut } from 'lucide-react'
import { MoreMenu } from '@/components/ui/more-menu'
import { type HeldPiece, type LibraryView } from '@/lib/dataClient'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

/**
 * A shared piece the user is on hold for (migration 0014): its owner's piece is over its member limit and the user joined
 * last. It looks like a member's card but is not a link, since the piece cannot be opened; it says why in words, names who
 * shared it, and its menu offers Leave, as a member's card does.
 */
export function HeldPieceCard({ piece, view = 'cards', onLeave }: { piece: HeldPiece; view?: LibraryView; onLeave: () => void }) {
  const list = view === 'list'
  return (
    <div className="relative flex min-w-0 flex-1" data-view={view} data-held="true">
      <div
        className={cn(
          'flex min-w-0 flex-1 gap-4 rounded-card border border-dashed border-border bg-surface p-5',
          list ? 'min-h-[84px] flex-col justify-center pe-16 sm:flex-row sm:items-center sm:justify-between' : 'min-h-[188px] flex-col',
        )}
      >
        <div className={cn(list ? 'min-w-0 sm:flex-1' : 'flex-1')}>
          {/* Room on the right for the menu button, so a long title never runs under it. */}
          <div className={cn('text-xl leading-[1.2] font-semibold break-words text-text-soft', !list && 'pe-10')}>{piece.title}</div>
          {piece.ownerName !== null && <div className="mt-1 text-sm leading-[1.3] text-text-soft">{strings.library.sharedBy(piece.ownerName)}</div>}
        </div>
        <div className={cn('flex items-start gap-2 text-sm leading-[1.3] font-medium text-text-soft', list && 'sm:w-60 sm:shrink-0')}>
          <CirclePause className="mt-px size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          <span>{strings.library.onHold}</span>
        </div>
      </div>
      <MoreMenu
        label={strings.library.moreFor(piece.title)}
        items={[{ label: strings.library.menuLeave, icon: LogOut, onSelect: onLeave }]}
        className={cn('absolute end-2.5', list ? 'top-2.5 sm:top-5' : 'top-2.5')}
      />
    </div>
  )
}
