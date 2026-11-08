import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { PlayOrderForm } from '@/components/structure/PlayOrderForm'
import { Switch } from '@/components/ui/switch'
import { type EditResult, type EditorDoc, partBarsDiffer } from '@/domain/pieceEdits'
import { formatStructure, structureOf } from '@/domain/structureText'
import { listedMarks } from '@/domain/markRanges'
import { barTally, pieceTally } from '@/domain/shortBars'
import { type ClickMode } from '@/domain/types'
import { BarNamesProvider } from '@/lib/BarNamesProvider'
import { useBarNamesOf } from '@/lib/barNamesContext'
import { strings } from '@/strings'
import { BarsForm, type BarsPrefill } from './BarsForm'
import { MarksForm } from './MarksForm'
import { MetersForm } from './MetersForm'
import { PartBarsForm } from './PartBarsForm'
import { RestsText } from './RestsText'
import { SafetyCard } from './SafetyCard'
import { StructureText } from './StructureText'

const text = strings.structure

/** The tabs: the piece's (shared by every part, locked unless Edit piece structure is on) and the open part's own. */
export type StructureSection = 'bars' | 'meters' | 'playOrder' | 'marks' | 'partBars' | 'rests'
type Section = StructureSection
const PIECE_SECTIONS: Section[] = ['bars', 'meters', 'playOrder', 'marks']
const PART_SECTIONS: Section[] = ['partBars', 'rests']
const TEXT_SECTIONS: Section[] = ['meters', 'playOrder', 'marks']

export interface StructurePanelProps {
  doc: EditorDoc
  /** The display name of each part, in part order: the doc holds only their ids. */
  parts: { id: string; name: string }[]
  /** The part open in the editor: the rests of Marks, and of "Edit as text", are its own. */
  partId: string
  /** The Edit sheet's "Renumber the bars after" switch: 'ripple' when it is on (the default), 'plain' when it is off. */
  barLineMode: ClickMode
  open: boolean
  section: Section
  onOpenChange(open: boolean, section?: StructurePanelProps['section']): void
  /** Prefill for the Bars section, e.g. from the status line after a part edit: { action: 'insert', bar: 22 }. */
  barsPrefill?: BarsPrefill
  onEdit(result: EditResult): void // the page passes it to useEditorDoc.apply
  /** A realign is running: its result would overwrite a Structure edit, so the forms are disabled and a note says why. */
  busy?: boolean
  /** The height the open section needs to show all of it, in px, whenever it changes; the page gives that height to the region. Not called while closed. */
  onFit?(height: number): void
  /** "Edit piece structure" is on: the Piece tabs can be changed. Off, they are shown locked with a way to turn it on. */
  pieceOn?: boolean
  onRequestPieceOn?(): void
  /** The card's switch turned off (the toolbar's switch does the same). */
  onRequestPieceOff?(): void
  /** The Renumber switch beside Insert / Remove. */
  onBarLineModeChange?(mode: ClickMode): void
}

const chipClass =
  'relative h-9 shrink-0 rounded-full border border-border bg-surface-2 px-4 text-sm font-medium text-text outline-none after:absolute after:-inset-y-1 after:inset-x-0 hover:bg-surface-3 focus-visible:ring-3 focus-visible:ring-ring/50 aria-selected:border-primary-strong aria-selected:text-primary-strong'

/**
 * The Structure panel, docked at the bottom of the editor. Collapsed it is only its title, to give the score the room (Erez,
 * 2026-11-01); open it opens downward in place of the waveform dock, with two groups of tabs (Decisions 2026-11-03): the
 * piece's (Bars, Meters, Play order, Marks), locked unless Edit piece structure is on, and the open part's (its Bars and
 * Rests), each applied with its own Apply button as one step.
 * "Edit as text", which only the open panel has, swaps the meters, play order and marks forms for one textarea holding the same data.
 */
export function StructurePanel({
  doc,
  parts,
  partId,
  barLineMode,
  open,
  section,
  onOpenChange,
  barsPrefill,
  onEdit,
  busy = false,
  onFit,
  pieceOn = true,
  onRequestPieceOn,
  onRequestPieceOff,
  onBarLineModeChange,
}: StructurePanelProps) {
  const id = useId()
  // The labels the bars go by here come from this doc, so a form's fields are read the way the doc's bars are shown.
  const names = useBarNamesOf(doc.timing.shortBars)
  const namesKey = JSON.stringify(doc.timing.shortBars)
  // The bars the piece and each part had when the Editor opened (view state, never saved): the Detected chip of the Bars tabs.
  const [detected] = useState(() => ({ piece: pieceTally(doc.timing), parts: new Map(doc.pages.map((page) => [page.partId, barTally(page.bars, doc.timing.shortBars)])) }))
  const [asText, setAsText] = useState(false)
  const { meters, playOrder } = doc.timing
  const openPage = doc.pages.find((page) => page.partId === partId)
  const marks = listedMarks(doc.timing, openPage)
  const partName = parts.find((part) => part.id === partId)?.name ?? ''
  // With one part, "This part" and "Piece" are the same bars: the group hides, and its Rests tab joins the main row. It shows
  // again for as long as the part's bars differ from the piece's, because This part > Bars holds the fixes for that.
  const onePart = parts.length === 1
  const partGroup = !onePart || partBarsDiffer(doc, partId)
  const partBarsGone = open && !partGroup && section === 'partBars'
  useEffect(() => {
    if (partBarsGone) onOpenChange(true, 'bars')
  }, [partBarsGone, onOpenChange])

  // "Edit as text" belongs to the open panel: closing it turns the text off, so reopening shows the forms.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setAsText(false)
  }

  // Each group has its text: the piece's meters, play order and marks, and the part's rests. Turning it on from a tab
  // without one moves to its group's text tab (Meters, or Rests).
  const toggleText = (on: boolean) => {
    setAsText(on)
    if (on && section === 'bars') onOpenChange(true, 'meters')
    if (on && section === 'partBars') onOpenChange(true, 'rests')
  }

  // Escape closes the open panel, wherever the focus is.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  // The natural height of the open section (its heading, note and form), measured on a content box that has no height of
  // its own, and again whenever it changes (a row added to the play order).
  const contentRef = useRef<HTMLDivElement>(null)
  const fit = useRef(onFit)
  useLayoutEffect(() => {
    fit.current = onFit
  })
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!open || content === null) return
    const measure = () => fit.current?.(Math.ceil(content.offsetHeight))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [open, section, asText])

  const showText = asText && TEXT_SECTIONS.includes(section)
  const heading = showText
    ? text.text.label
    : asText && section === 'rests'
      ? text.text.restsLabel
      : section === 'partBars'
        ? text.partBarsHeading(partName)
        : text.sections[section]
  const pieceSection = PIECE_SECTIONS.includes(section)
  const locked = pieceSection && !pieceOn
  const tab = (value: Section, label?: string) => (
    <button
      key={value}
      type="button"
      role="tab"
      id={`${id}-tab-${value}`}
      aria-selected={section === value}
      aria-controls={`${id}-body`}
      aria-label={label}
      onClick={() => onOpenChange(true, value)}
      className={chipClass}
    >
      {text.sections[value]}
    </button>
  )

  return (
    <BarNamesProvider names={names}>
    <section aria-label={text.title} className="relative flex flex-col gap-3 border-t border-border px-6 py-3 lg:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => onOpenChange(!open)}
          className="flex h-9 items-center gap-2 rounded-lg pe-2 text-sm font-semibold tracking-[0.06em] text-text-soft uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          {text.title}
        </button>
        {/* The tabs and the text switch exist only while the panel is open. */}
        {open && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div role="tablist" aria-label={text.groups.piece} className="flex flex-wrap items-center gap-2">
              <span aria-hidden className="text-xs font-semibold tracking-wider text-text-muted uppercase">
                {onePart ? text.groups.pieceOnePart : text.groups.piece}
              </span>
              {PIECE_SECTIONS.map((value) => tab(value))}
              {!partGroup && tab('rests', `${text.sections.rests} (${text.groups.part(partName)})`)}
            </div>
            {partGroup && (
              <div role="tablist" aria-label={text.groups.part(partName)} className="flex flex-wrap items-center gap-2 border-s border-border ps-5">
                <span aria-hidden className="text-xs font-semibold tracking-wider text-text-muted uppercase">
                  {text.groups.partLabel}
                </span>
                {PART_SECTIONS.map((value) => tab(value, `${text.sections[value]} (${text.groups.part(partName)})`))}
              </div>
            )}
          </div>
        )}
        {open && (
          <label className="ms-auto flex items-center gap-3 text-sm text-text-soft">
            <span id={`${id}-text-label`}>{text.editAsText}</span>
            <Switch checked={asText} onCheckedChange={toggleText} aria-labelledby={`${id}-text-label`} />
          </label>
        )}
      </div>
      {open && (
        <div
          id={`${id}-body`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${section}`}
          data-slot="structure-body"
          // Opens downward over the dock region right under the strip. The page sets --region-height to the height the
          // section needs (--dock-height on a small window), so the panel takes the dock's place and scrolls inside only
          // once the content outgrows the region. The dock stays mounted (and playing) beneath it.
          className="absolute start-0 end-0 top-full z-20 h-(--dock-height,262px) overflow-y-auto bg-surface lg:h-(--region-height,262px)"
        >
          <div ref={contentRef} data-slot="structure-content" className="flex shrink-0 flex-col gap-4 border-t border-border px-6 py-5">
            <h2 className="text-sm font-semibold tracking-[0.06em] text-text-muted uppercase">{heading}</h2>
            {busy && <p className="text-sm text-warning-text">{text.busy}</p>}
            {pieceSection && <SafetyCard on={pieceOn} onRequestOn={onRequestPieceOn} onRequestOff={onRequestPieceOff} />}
            <fieldset disabled={busy || locked} className="flex min-w-0 flex-col gap-4 border-0 p-0">
              {section === 'bars' && (
                <BarsForm
                  doc={doc}
                  detected={detected.piece}
                  locked={locked}
                  barLineMode={barLineMode}
                  onBarLineModeChange={onBarLineModeChange}
                  prefill={barsPrefill}
                  onEdit={onEdit}
                />
              )}
              {asText && section === 'rests' && <RestsText key={`rests-text:${partId}:${namesKey}:${JSON.stringify(openPage?.rests)}`} doc={doc} partId={partId} partName={partName} onEdit={onEdit} />}
              {showText && <StructureText key={`${partId}:${formatStructure(structureOf(doc.timing, openPage), doc.timing.barCount, names)}`} doc={doc} partId={partId} onEdit={onEdit} />}
              {!showText && section === 'meters' && <MetersForm key={`${namesKey}:${JSON.stringify(meters)}`} doc={doc} onEdit={onEdit} />}
              {!showText && section === 'playOrder' && <PlayOrderForm key={`${namesKey}:${JSON.stringify(playOrder)}`} doc={doc} onEdit={onEdit} />}
              {!showText && section === 'marks' && (
                <MarksForm key={`${partId}:${namesKey}:${JSON.stringify(marks)}`} doc={doc} partId={partId} partName={partName} onEdit={onEdit} kinds={['fermata', 'rit']} />
              )}
              {section === 'partBars' && <PartBarsForm key={partId} doc={doc} partId={partId} detected={detected.parts.get(partId) ?? barTally(openPage?.bars ?? [], doc.timing.shortBars)} onEdit={onEdit} />}
              {!asText && section === 'rests' && (
                <MarksForm key={`rests:${partId}:${namesKey}:${JSON.stringify(openPage?.rests)}`} doc={doc} partId={partId} partName={partName} onEdit={onEdit} kinds={['rest']} />
              )}
            </fieldset>
          </div>
        </div>
      )}
    </section>
    </BarNamesProvider>
  )
}
