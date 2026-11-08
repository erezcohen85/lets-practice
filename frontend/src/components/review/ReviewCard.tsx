import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { Fragment } from 'react'
import { chipsOf, explanationOf, type ChipTone } from '@/components/review/reviewText'
import { formatClock } from '@/components/waveform/dockLayout'
import { ActionIcon, type ActionName } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { type BarNames } from '@/domain/barNames'
import { isPendingPulse } from '@/domain/pulseRegrid'
import { type ReviewItem } from '@/domain/reviewQueue'
import { useBarNames } from '@/lib/barNamesContext'
import { cn } from '@/lib/utils'
import { barWithPass, strings } from '@/strings'

const text = strings.review

// Complete class names, so Tailwind finds them.
const TONE_CLASSES: Record<ChipTone, string> = {
  crowded: 'bg-flag-crowded-bg text-flag-crowded-text',
  beatCount: 'bg-flag-beat-count-bg text-flag-beat-count-text',
  weakDownbeat: 'bg-flag-weak-downbeat-bg text-flag-weak-downbeat-text',
  stretched: 'bg-flag-stretched-bg text-flag-stretched-text',
  explained: 'bg-surface-3 text-text-soft',
  moved: 'bg-moved-bg text-moved-text',
  warning: 'bg-warning-bg text-warning-text',
}

export type ReviewAction = 'sounds-right' | 'resolved' | 'undo-move' | 'realign' | 'open-structure' | 'put-back' | 'use-suggested-edge' | 'dismiss-flag' | 'regrid-pulse'

export interface ReviewCardProps {
  item: ReviewItem
  /** Names the part for a part item's title and sentence. */
  partName: string
  /** How far a hand-moved item sits from where it was, in seconds. */
  movedBySec: number | null
  open: boolean
  realigning: boolean
  /** Whether Realign may be offered on a bar without a time. Default true. */
  canRealign?: boolean
  /** Whether the Wrong beat card may offer to put the bar lines on the beats (the page has what it takes). Default true. */
  canPulse?: boolean
  /** A sentence under the buttons of the open card: why the last press changed nothing. */
  notice?: string | null
  onToggle(): void
  onAction(action: ReviewAction): void
}

function titleOf(item: ReviewItem, partName: string, names: BarNames): string {
  if (item.kind === 'part') return text.queue.part(partName)
  return text.queue.bar(item.kind === 'box' ? names.label(item.bar) : barWithPass(names.label(item.bar), item.passIndex))
}

/** A pulse flag that still asks for the lines to go on the beats (the domain's one rule, which the card's edit goes by too): the Wrong beat card's own button comes before the rest. */
const wantsBeats = (item: ReviewItem): boolean => item.kind === 'flag' && isPendingPulse(item)

/** The actions an open card offers, by what the item is. */
function actionsOf(item: ReviewItem): ReviewAction[] {
  if (item.kind === 'part') return ['open-structure']
  // A box Advanced Reading moved carries its old edges: Put back comes first, then the check's suggested edge, then Dismiss.
  if (item.kind === 'box') {
    const hasPrevious = item.flag.previous !== undefined && item.flag.previous !== null
    return [...(hasPrevious ? (['put-back'] as const) : []), ...(item.flag.suggestedX === null ? [] : (['use-suggested-edge'] as const)), 'dismiss-flag']
  }
  if (item.kind === 'unmatched') return ['realign']
  const rest: ReviewAction[] = item.moved ? ['resolved', 'undo-move'] : item.checked ? [] : ['sounds-right']
  return wantsBeats(item) ? ['regrid-pulse', ...rest] : rest
}

/**
 * One item of the queue: a button that opens it and, open, says what is wrong and what to do about it. The spaces
 * between the parts of the button are there for the accessible name ("Bar 6 Crowded 0:14.2"), not for the layout.
 */
export function ReviewCard({ item, partName, movedBySec, open, realigning, canRealign = true, canPulse = true, notice = null, onToggle, onAction }: ReviewCardProps) {
  const names = useBarNames()
  const checked = item.kind === 'flag' && item.checked
  const detailId = `review-detail-${item.kind === 'part' ? 'part' : item.kind === 'box' ? `box-${item.bar}` : `${item.bar}-${item.passIndex}`}`
  const Chevron = open ? ChevronUp : ChevronDown
  const actions = actionsOf(item).filter((action) => (canRealign || action !== 'realign') && (canPulse || action !== 'regrid-pulse'))
  const labels: Record<ReviewAction, string> = {
    'sounds-right': text.queue.soundsRight,
    resolved: text.queue.resolved,
    'undo-move': text.queue.undoMove,
    realign: realigning ? strings.editor.status.realigning : strings.editor.status.realign,
    'open-structure': strings.editor.status.openStructure,
    'put-back': text.queue.putBack,
    'use-suggested-edge': text.queue.useSuggestedEdge,
    'dismiss-flag': text.queue.dismissFlag,
    'regrid-pulse': text.queue.putOnBeats,
  }
  // Only the first action is a filled button, and only a filled button carries an icon.
  const icons: Record<ReviewAction, ActionName> = {
    'sounds-right': 'confirm',
    resolved: 'confirm',
    'undo-move': 'undo',
    realign: 'realign',
    'open-structure': 'fix',
    'put-back': 'undo',
    'use-suggested-edge': 'confirm',
    'dismiss-flag': 'dismiss',
    'regrid-pulse': 'fix',
  }
  return (
    <li data-slot="review-card" className={cn('rounded-xl border bg-surface-2', open ? 'border-2 border-selected' : 'border-border')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={(event) => {
          onToggle()
          // Opened with the mouse (detail > 0), the card gives up focus, so Space plays from the bar instead of pressing the card again.
          // Opened from the keyboard (detail 0), it keeps focus, so a keyboard user stays in the list.
          if (event.detail > 0) event.currentTarget.blur()
        }}
        className="flex min-h-12 w-full items-center gap-2 rounded-xl px-4 py-3 text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Check aria-hidden="true" className={cn('size-4 shrink-0 text-primary-strong', !checked && 'invisible')} strokeWidth={2.5} />
        <span className="shrink-0 font-semibold whitespace-nowrap">{titleOf(item, partName, names)}</span>{' '}
        {chipsOf(item).map((chip) => (
          <Fragment key={chip.key}>
            {/* A checked item is done: its chips go quiet (board: Editor.png), unless it was moved since. */}
            <span
              title={chip.label}
              className={cn(
                'min-w-0 truncate rounded-md px-2 py-0.5 text-[13px] font-medium whitespace-nowrap',
                checked && chip.tone !== 'moved' ? TONE_CLASSES.explained : TONE_CLASSES[chip.tone],
              )}
            >
              {chip.label}
            </span>{' '}
          </Fragment>
        ))}
        {checked && (
          <>
            <span className="sr-only">{text.queue.checkedMark}</span>{' '}
          </>
        )}
        <span className="ms-auto shrink-0 text-sm whitespace-nowrap text-text-soft tabular-nums">{item.kind === 'flag' ? formatClock(item.timeSec) : ''}</span>
        <Chevron aria-hidden="true" className="size-4 shrink-0 text-text-soft" />
      </button>
      {open && (
        <div id={detailId} className="flex flex-col gap-3 px-4 pb-4">
          {explanationOf(item, { partName, movedBySec, names }).map((sentence) => (
            <p key={sentence} className="text-[15px] text-text-soft">
              {sentence}
            </p>
          ))}
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.map((action, index) => (
                <Button
                  key={action}
                  size="touch"
                  variant={index === 0 ? 'default' : 'outline'}
                  disabled={action === 'realign' && realigning}
                  title={action === 'realign' ? strings.editor.status.realignTip : undefined}
                  className={action === 'realign' ? 'disabled:pointer-events-auto' : undefined}
                  onClick={() => onAction(action)}
                >
                  {index === 0 && <ActionIcon action={icons[action]} />}
                  {labels[action]}
                </Button>
              ))}
            </div>
          )}
          {/* Why the last press changed nothing: a live region, so a screen reader hears it when it appears. */}
          {notice !== null && (
            <p role="status" className="text-[15px] text-warning-text">
              {notice}
            </p>
          )}
        </div>
      )}
    </li>
  )
}
