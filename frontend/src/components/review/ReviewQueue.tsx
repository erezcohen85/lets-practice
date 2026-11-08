import { CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ReviewCard, type ReviewAction } from '@/components/review/ReviewCard'
import { ReviewProgress } from '@/components/review/ReviewProgress'
import { isTextField } from '@/components/score/useScoreZoom'
import { type SlotRef } from '@/components/waveform/WaveformDock'
import { Button } from '@/components/ui/button'
import { applySuggestedEdge, dismissBoxFlag, putBackBox } from '@/domain/boxFlagEdits'
import { type EditRefusal, type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { nextProblem, reviewCounts, reviewItems, type ReviewItem } from '@/domain/reviewQueue'
import { canResolveAll, resolveAllOpen } from '@/domain/reviewEdits'
import { movedOffsets, resolveMoved, soundsRight, undoMove } from '@/domain/timingEdits'
import { strings } from '@/strings'

const text = strings.review.queue

type FlagItem = Extract<ReviewItem, { kind: 'flag' }>

/** The button that folds the queue to its rail and unfolds it again (36 px, the same on both). */
function FoldButton({ folded, onClick }: { folded: boolean; onClick(): void }) {
  const Icon = folded ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={folded ? text.show : text.hide}
      aria-expanded={!folded}
      title={folded ? text.show : text.hide}
      onClick={onClick}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border-strong bg-surface-2 text-text-soft outline-none transition-colors hover:text-text focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Icon aria-hidden className="size-5" />
    </button>
  )
}

const keyOf = (item: ReviewItem) => (item.kind === 'part' ? 'part' : item.kind === 'box' ? `box:${item.bar}` : `${item.bar}:${item.passIndex}`)
const isMovedItem = (item: ReviewItem | undefined): item is FlagItem => item !== undefined && item.kind === 'flag' && item.moved

export interface ReviewQueueProps {
  doc: EditorDoc
  partId: string
  partName: string
  /** The slot picked on the waveform: R resolves it when it is a moved item and no card is open. */
  selected: SlotRef | null
  /** Records and saves an edit of the doc; gives the reason back when it was refused. */
  onApply(result: EditResult): EditRefusal | null
  /** A card was opened (by a click or by N): the page selects its slot, seeks the transport and shows its page. */
  onFocusItem(item: ReviewItem): void
  realigning: boolean
  /** Whether Realign may be offered. Default true. */
  canRealign?: boolean
  onRealign(): void
  onOpenStructure(): void
  /** A sentence for the hint line when an action of a card was refused and the user would otherwise see nothing happen (Put back line). */
  onNotice?(sentence: string): void
  /**
   * The Wrong beat card's button: the page puts the bar lines of the whole piece on the beats and resolves the card as one step.
   * Gives back the sentence of why nothing changed (the card shows it and stays), or null when it did. Left out: the card offers no button.
   */
  onPulseRegrid?(): string | null
}

/**
 * The right column of the Editor: "x of y checked" with its progress bar, the Moved by you row, and one card per item
 * of the part. The open card is view state. N opens the next open item and R resolves the open (or selected) moved one;
 * neither fires in a text field, and both keep working while the queue is folded to its rail (the button at the top
 * right; the folded state is view state, for this visit only). Every action is one step of the editor's history.
 */
export function ReviewQueue({ doc, partId, partName, selected, onApply, onFocusItem, realigning, canRealign = true, onRealign, onOpenStructure, onNotice, onPulseRegrid }: ReviewQueueProps) {
  const items = reviewItems(doc, partId)
  const counts = reviewCounts(items)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [folded, setFolded] = useState(false)
  // Why the last press of Put bar lines on the beats changed nothing: shown on that card while the timing is as it was, so any edit, Undo or Redo takes it away.
  const [pulseNotice, setPulseNotice] = useState<{ key: string; timing: EditorDoc['timing']; sentence: string } | null>(null)
  const openIndex = openKey === null ? -1 : items.findIndex((item) => keyOf(item) === openKey)
  const movedItems = items.filter(isMovedItem)
  const offsets = movedOffsets(doc)

  const open = (item: ReviewItem) => {
    setOpenKey(keyOf(item))
    onFocusItem(item)
  }

  // The keys read the latest items and callbacks without re-attaching the listener on every edit.
  const latest = useRef({ items, openIndex, selected, onApply, open })
  useEffect(() => {
    latest.current = { items, openIndex, selected, onApply, open }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return
      const { items: current, openIndex: at, selected: slot, onApply: apply, open: openItem } = latest.current
      const key = event.key.toLowerCase()
      if (key === 'n') {
        const next = nextProblem(current, at === -1 ? null : at)
        if (next === null) return
        event.preventDefault()
        openItem(current[next])
      } else if (key === 'r') {
        const open = current[at]
        const target = isMovedItem(open)
          ? open
          : current.filter(isMovedItem).find((item) => slot !== null && item.bar === slot.bar && item.passIndex === slot.passIndex)
        if (target === undefined) return
        event.preventDefault()
        apply(resolveMoved(doc, target.bar, target.passIndex))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc])

  // The opened card comes into view in the list, whole: its explanation and buttons too. It does so again when its
  // content changes (moved, unmoved, resolved: another sentence and other buttons), not on other re-renders.
  const listRef = useRef<HTMLUListElement>(null)
  const openItem = items[openIndex]
  const openContent = openItem === undefined || openItem.kind !== 'flag' ? '' : `${openItem.moved}:${openItem.checked}`
  useEffect(() => {
    if (openKey === null) return
    listRef.current?.querySelector('[aria-expanded="true"]')?.closest('li')?.scrollIntoView?.({ block: 'nearest' })
  }, [openKey, openContent])

  const act = (item: ReviewItem, action: ReviewAction) => {
    if (action === 'realign') return onRealign()
    if (action === 'open-structure') return onOpenStructure()
    if (action === 'regrid-pulse') {
      const sentence = onPulseRegrid?.() ?? null
      setPulseNotice(sentence === null ? null : { key: keyOf(item), timing: doc.timing, sentence })
      return
    }
    if (item.kind === 'box') {
      if (action === 'put-back') {
        if (onApply(putBackBox(doc, partId, item.bar)) !== null) onNotice?.(text.putBackRefused)
        return
      }
      onApply(action === 'use-suggested-edge' ? applySuggestedEdge(doc, partId, item.bar) : dismissBoxFlag(doc, partId, item.bar))
      return
    }
    if (item.kind !== 'flag') return
    const edit = action === 'sounds-right' ? soundsRight : action === 'resolved' ? resolveMoved : undoMove
    onApply(edit(doc, item.bar, item.passIndex))
  }

  if (folded) {
    return (
      <aside aria-label={text.title} data-slot="review-rail" className="flex min-h-0 w-14 shrink-0 flex-col items-center gap-4 px-2.5 py-6 max-lg:hidden">
        <FoldButton folded onClick={() => setFolded(false)} />
        <span className="text-[15px] font-bold [writing-mode:vertical-rl]">{text.title}</span>
        <span
          data-slot="review-rail-badge"
          title={text.left(counts.open)}
          aria-label={text.left(counts.open)}
          className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-selected-chip-bg px-1.5 text-[13px] font-bold text-selected-chip-text"
        >
          {counts.open}
        </span>
      </aside>
    )
  }

  return (
    <aside aria-label={text.title} className="flex min-h-0 w-(--queue-width,360px) shrink-0 flex-col gap-3 p-6 max-lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{text.title}</h2>
        <div className="flex items-center gap-3">
          <span className="text-[15px] text-text-soft">{text.checked(counts.checked, counts.total)}</span>
          <FoldButton folded={false} onClick={() => setFolded(true)} />
        </div>
      </div>
      {/* Resolve all: no question, Undo is the safety. Off when it has nothing to check (bars without a time and part bar counts stay: only fixing them removes them). */}
      <div className="flex justify-end">
        <Button variant="outline" size="lg" disabled={!canResolveAll(doc, partId)} onClick={() => onApply(resolveAllOpen(doc, partId))}>
          <CheckCheck aria-hidden />
          {text.resolveAll}
        </Button>
      </div>
      <ReviewProgress checked={counts.checked} moved={counts.moved} total={counts.total} />
      {counts.moved > 0 && <p className="text-sm text-text-soft">{text.hatched(counts.moved)}</p>}
      {movedItems.length > 0 && (
        <span className="text-sm font-semibold tracking-wide text-moved uppercase">{text.movedByYou(movedItems.length)}</span>
      )}
      {items.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong p-4 text-[15px] text-text-muted">{text.empty}</p>
      ) : (
        <ul ref={listRef} aria-label={text.list} className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {items.map((item, index) => (
            <ReviewCard
              key={keyOf(item)}
              item={item}
              partName={partName}
              movedBySec={item.kind === 'flag' ? (offsets.find((moved) => moved.bar === item.bar && moved.passIndex === item.passIndex)?.deltaSec ?? null) : null}
              open={index === openIndex}
              realigning={realigning}
              canRealign={canRealign}
              canPulse={onPulseRegrid !== undefined}
              notice={pulseNotice !== null && pulseNotice.timing === doc.timing && pulseNotice.key === keyOf(item) ? pulseNotice.sentence : null}
              onToggle={() => (index === openIndex ? setOpenKey(null) : open(item))}
              onAction={(action) => act(item, action)}
            />
          ))}
        </ul>
      )}
    </aside>
  )
}
