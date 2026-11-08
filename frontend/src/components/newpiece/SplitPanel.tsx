import { ArrowDown, ArrowUp, RotateCcw, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { PagePreview } from '@/components/newpiece/PagePreview'
import { type SplitChoice } from '@/components/newpiece/useSplitChoice'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { canMoveBoundary, canSkipPage, canSplitAt, pageRuns, splitIsValid, splitProblems, type SplitPage, type SplitPart, type SplitProposal } from '@/domain/splitEdits'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const t = strings.split

const nameProblemText = { empty: t.problems.nameEmpty, 'too-long': t.problems.nameTooLong } as const
const boundaryButtonClass = 'h-9 gap-1.5 border-border bg-transparent px-3 text-sm text-text-soft dark:border-border dark:bg-transparent dark:hover:bg-surface-2'

/** The words for a part in a button: its name, or "part N" while the field is empty. */
const labelOf = (part: SplitPart, index: number) => part.name.trim() || t.unnamed(index + 1)

/**
 * One page of a part: its picture (the page itself), its number, an X in the top right corner that drops the page from the
 * part, and "New part here". A dropped page stays in place, dimmed and struck through (not by colour alone), with the X
 * turned into Restore. The pointer resting on the tile, or keyboard focus in it, floats the picture at 320 px beside it;
 * a touch screen keeps the plain tile.
 */
function PageTile({
  page,
  number,
  startable,
  muted,
  skipped,
  canDiscard,
  onStartHere,
  onToggleSkip,
}: {
  page: SplitPage | undefined
  number: number
  startable: boolean
  muted: boolean
  skipped: boolean
  canDiscard: boolean
  onStartHere: () => void
  onToggleSkip: () => void
}) {
  const picture = useRef<HTMLDivElement>(null)
  // A press of the pointer (a tap, a click) puts the focus on the X; only focus that came by the keyboard shows the picture.
  const pressing = useRef(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const showing = (hovered || focused) && anchor !== null && page !== undefined

  function show(source: 'pointer' | 'focus', on: boolean) {
    if (source === 'pointer') setHovered(on)
    else setFocused(on)
    if (on) setAnchor(picture.current?.getBoundingClientRect() ?? null)
  }

  // A scroll moves the tile from under the floating picture: it goes away until the pointer comes back.
  useEffect(() => {
    if (!showing) return
    const hide = () => {
      setHovered(false)
      setFocused(false)
    }
    window.addEventListener('scroll', hide, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', hide, { capture: true })
  }, [showing])

  const discardLabel = skipped ? t.restorePage(number) : t.discardPage(number)
  const Icon = skipped ? RotateCcw : X

  return (
    <div
      className="flex w-[72px] flex-col items-center gap-1"
      onPointerEnter={(event: PointerEvent) => event.pointerType !== 'touch' && show('pointer', true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={() => (pressing.current = true)}
      onPointerUp={() => (pressing.current = false)}
      onPointerCancel={() => (pressing.current = false)}
      onFocus={() => show('focus', !pressing.current)}
      onBlur={() => setFocused(false)}
    >
      <div ref={picture} className="relative h-[94px] w-[72px]">
        {/* The picture is the page itself, so the sentence for a screen reader is its number. */}
        {page === undefined ? (
          <span className="flex h-[94px] w-[72px] items-center justify-center rounded-md border border-border bg-surface-2 text-sm text-text-muted" role="img" aria-label={t.page(number)} />
        ) : (
          <img src={page.thumb} alt={t.page(number)} loading="lazy" className={cn('h-[94px] w-[72px] rounded-md border border-border bg-white object-contain', (muted || skipped) && 'opacity-40')} />
        )}
        {skipped && (
          <svg aria-hidden="true" viewBox="0 0 72 94" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full text-text-soft">
            <line x1="0" y1="94" x2="72" y2="0" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        {/* 28 px to look at, 44 px to hit. */}
        <button
          type="button"
          aria-label={discardLabel}
          title={!skipped && !canDiscard ? t.lastPageKept : undefined}
          disabled={!skipped && !canDiscard}
          onClick={onToggleSkip}
          className="group absolute top-0 end-0 flex size-11 items-center justify-center rounded-md outline-none disabled:cursor-not-allowed"
        >
          <span className="flex size-7 items-center justify-center rounded-full border border-border-strong bg-surface text-text group-hover:bg-surface-3 group-focus-visible:ring-3 group-focus-visible:ring-ring/50 group-disabled:opacity-50">
            <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
      </div>
      <span className={cn('text-xs leading-[1.3] text-text-muted', skipped && 'line-through')}>{number}</span>
      {startable && !skipped && (
        <button
          type="button"
          aria-label={t.startHere(number)}
          onClick={onStartHere}
          className="flex min-h-9 items-center rounded-md px-2 text-xs leading-[1.2] text-primary-strong underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {t.newPartHere}
        </button>
      )}
      {showing && anchor !== null && page !== undefined && <PagePreview anchor={anchor} src={page.thumb} />}
    </div>
  )
}

function PartCard({
  index,
  parts,
  pages,
  nameProblem,
  split,
}: {
  index: number
  parts: SplitPart[]
  pages: SplitPage[]
  nameProblem: string | undefined
  split: SplitChoice
}) {
  const part = parts[index]
  const next = parts[index + 1]
  const errorId = useId()
  const numbers = Array.from({ length: part.toPage - part.fromPage + 1 }, (_, offset) => part.fromPage + offset)

  return (
    <li className={cn('flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3', !part.keep && 'bg-surface/50')}>
      <div className="flex items-center gap-3">
        <Checkbox checked={part.keep} onCheckedChange={(checked) => split.keep(index, checked)} aria-label={t.keep(labelOf(part, index))} />
        <Input
          aria-label={t.partName}
          aria-invalid={nameProblem === undefined ? undefined : true}
          aria-describedby={nameProblem === undefined ? undefined : errorId}
          value={part.name}
          onChange={(event) => split.rename(index, event.target.value)}
          autoComplete="off"
          className={cn('h-10 min-w-0 flex-1 rounded-md border-border bg-background px-3 py-0 text-base md:text-base dark:bg-background', !part.keep && 'text-text-muted')}
        />
        <div className="flex shrink-0 flex-col items-end text-sm leading-[1.3] text-text-soft">
          <span>{t.pages(pageRuns(part))}</span>
          {!part.keep && <span className="text-text-muted">{t.notUsed}</span>}
        </div>
      </div>
      {nameProblem !== undefined && (
        <p id={errorId} className="text-sm text-problem">
          {nameProblem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {numbers.map((number) => (
          <PageTile
            key={number}
            number={number}
            page={pages.find((page) => page.page === number)}
            startable={canSplitAt(parts, index, number)}
            muted={!part.keep}
            skipped={part.skipPages.includes(number)}
            canDiscard={canSkipPage(part, number)}
            onStartHere={() => split.splitAt(index, number)}
            onToggleSkip={() => split.toggleSkip(index, number)}
          />
        ))}
      </div>
      {next !== undefined && (
        <div role="group" aria-label={t.boundaryLabel(labelOf(part, index), labelOf(next, index + 1))} className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" disabled={!canMoveBoundary(parts, index, -1)} onClick={() => split.move(index, -1)} className={boundaryButtonClass}>
            <ArrowDown className="size-4" strokeWidth={2} aria-hidden="true" />
            {t.pageDown(part.toPage, labelOf(next, index + 1))}
          </Button>
          <Button type="button" variant="outline" disabled={!canMoveBoundary(parts, index, 1)} onClick={() => split.move(index, 1)} className={boundaryButtonClass}>
            <ArrowUp className="size-4" strokeWidth={2} aria-hidden="true" />
            {t.pageUp(next.fromPage, labelOf(part, index))}
          </Button>
          <Button type="button" variant="outline" aria-label={t.mergeLabel(labelOf(part, index), labelOf(next, index + 1))} onClick={() => split.merge(index)} className={boundaryButtonClass}>
            {t.merge}
          </Button>
        </div>
      )}
    </li>
  )
}

/**
 * The split screen: what the processor read from the page headers of one PDF, a row per proposed part with its name, its
 * pages and a picture of each page. The user renames, moves a page between neighbours, merges, starts a part at a page, or
 * unticks parts they do not want; "Use these parts" takes them back to the form once the processor would accept them.
 */
export function SplitPanel({ proposal, fileName, split }: { proposal: SplitProposal; fileName: string; split: SplitChoice }) {
  const { parts } = split
  const [attempted, setAttempted] = useState(false)
  const problems = splitProblems(parts)
  const keptProblem = problems.kept === null ? undefined : t.problems.none

  function confirm() {
    setAttempted(true)
    if (splitIsValid(problems)) split.confirm()
  }

  return (
    <section aria-label={t.title} className="flex flex-col gap-3">
      <p className="text-sm leading-[1.3] text-text-soft">{t.intro(fileName, proposal.pageCount)}</p>
      {proposal.note !== null && (
        <p role="status" className="rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning-text">
          {proposal.note}
        </p>
      )}
      <ul aria-label={t.partsList} className="flex flex-col gap-3">
        {parts.map((_, index) => {
          const problem = attempted ? problems.names[index] : undefined
          return (
            // The place in the list is the part's identity here: names and pages change with every edit.
            <PartCard key={index} index={index} parts={parts} pages={proposal.pages} nameProblem={problem === undefined ? undefined : nameProblemText[problem]} split={split} />
          )
        })}
      </ul>
      {attempted && keptProblem !== undefined && (
        <p role="alert" className="text-sm text-problem">
          {keptProblem}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="touch" onClick={() => split.discard()}>
          {t.chooseAnother}
        </Button>
        <Button type="button" size="touch" onClick={confirm}>
          <ActionIcon action="confirm" />
          {t.confirm}
        </Button>
      </div>
    </section>
  )
}
