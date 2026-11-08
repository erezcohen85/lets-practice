import { useId, useState } from 'react'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import {
  type EditResult,
  type EditorDoc,
  lastRestBar,
  setMarks,
  setMeters,
  setPlayOrder,
  setShortBars,
  validateMarks,
  validateMeters,
  validatePlayOrder,
} from '@/domain/pieceEdits'
import { firstBar as firstBarOf, hasPickup, tidyShortBars, validateShortBars } from '@/domain/shortBars'
import { listedMarks } from '@/domain/markRanges'
import { formatStructure, parseStructure, structureLineOf, structureOf, type Structure } from '@/domain/structureText'
import { meterAt } from '@/domain/renumber'
import { type BarNames } from '@/domain/barNames'
import { useBarNames } from '@/lib/barNamesContext'
import { strings } from '@/strings'
import { DroppedNote } from './DroppedNote'
import { structureErrorText } from './fields'

const text = strings.structure.text

type LineError = { line: number; message: string }

/** Every validation error of the parsed structure, each on the line of its part. */
function validationErrors(structure: Structure, source: string, doc: EditorDoc, partId: string, names: BarNames): LineError[] {
  const { barCount } = doc.timing
  const restLast = lastRestBar(doc.timing, doc.pages.find((page) => page.partId === partId))
  const firstBar = firstBarOf(doc.timing)
  const shortLine = structureLineOf(source, 'shortBars')
  const lastLabel = names.label(barCount)
  const firstLabel = names.label(firstBar)
  const shortBars = structure.shortBars ?? []
  const lengths = strings.structure.errors
  // The piece's text holds no rests: they belong to a part (This part > Rests).
  const rests = structure.marks.some((mark) => mark.kind === 'rest') ? [{ line: structureLineOf(source, 'marks'), message: text.restsInPiece }] : []
  return [
    ...rests,
    ...[
      ...validateMeters(structure.meters, barCount).map((error) => ({ line: structureLineOf(source, 'meters'), error, last: barCount })),
      ...validatePlayOrder(structure.playOrder, barCount, firstBar).map((error) => ({ line: structureLineOf(source, 'playOrder'), error, last: barCount })),
      // A rest is judged against its own part's last bar, the other marks against the piece's.
      ...validateMarks(structure.marks, barCount, firstBar, restLast).map((error) => ({
        line: structureLineOf(source, 'marks'),
        error,
        last: structure.marks[error.index].kind === 'rest' ? restLast : barCount,
      })),
    ].map(({ line, error, last }) => ({ line, message: structureErrorText(error, names.label(last), firstLabel) })),
    ...validateShortBars(shortBars, structure.meters, barCount).map((error) => {
      const meter = meterAt(structure.meters, shortBars[error.index].bar)
      const message = {
        'out-of-range': lengths.shortBarOutOfRange(lastLabel),
        duplicate: lengths.shortBarDuplicate,
        'not-shorter': lengths.shortBarNotShorter(`${meter.numerator}/${meter.denominator}`),
        'bad-unnumbered': lengths.pickupPlace,
      }[error.problem]
      // A pickup with no number of its own is on the pickups line; the others are on the short bars line.
      return { line: structureLineOf(source, shortBars[error.index].unnumbered === true ? 'pickups' : 'shortBars'), message }
    }),
    // Adding or removing the pickup renumbers every bar, so the numbers in the other lines would change meaning.
    ...(shortBars.some((short) => short.bar === 0) === hasPickup(doc.timing) ? [] : [{ line: shortLine, message: text.pickupChanged }]),
  ]
}

/**
 * The parts that differ from the doc, applied as a chain: meters, then play order, then marks, each on the doc the one
 * before produced, so the page records one step per changed part with the right state. Null when the text is not valid.
 */
function chainOf(doc: EditorDoc, partId: string, structure: Structure): EditResult[] | null {
  const { timing } = doc
  const page = doc.pages.find((existing) => existing.partId === partId)
  const shown = structureOf(timing, undefined)
  const rests = listedMarks(timing, page).filter((mark) => mark.kind === 'rest')
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const steps: ((from: EditorDoc) => EditResult)[] = []
  if (!same(structure.meters, timing.meters)) steps.push((from) => setMeters(from, structure.meters))
  if (!same(structure.playOrder, timing.playOrder)) steps.push((from) => setPlayOrder(from, structure.playOrder))
  if (!same(structure.marks, shown.marks)) steps.push((from) => setMarks(from, [...structure.marks, ...rests], partId))
  if (!same(tidyShortBars(structure.shortBars ?? []) ?? [], tidyShortBars(timing.shortBars ?? []) ?? [])) {
    steps.push((from) => setShortBars(from, structure.shortBars ?? []))
  }
  const results: EditResult[] = []
  let current = doc
  for (const step of steps) {
    const result = step(current)
    if (!result.ok) return null
    results.push(result)
    current = result.doc
  }
  return results
}

/** The piece's structure as three lines of text, the same data as the Piece forms; no rests (they are the open part's, `partId`, and kept as they are). The caller keys it by that structure. */
export function StructureText({ doc, partId, onEdit }: { doc: EditorDoc; partId: string; onEdit: (result: EditResult) => void }) {
  const id = useId()
  const barCount = doc.timing.barCount
  const firstBar = firstBarOf(doc.timing)
  const names = useBarNames()
  const [initial] = useState(() => formatStructure(structureOf(doc.timing, undefined), barCount, names))
  const [source, setSource] = useState(initial)
  const [errors, setErrors] = useState<LineError[]>([])

  const parsed = parseStructure(source, barCount, firstBar, names)
  const chain = parsed.ok && validationErrors(parsed.structure, source, doc, partId, names).length === 0 ? chainOf(doc, partId, parsed.structure) : null
  const dropped = chain === null ? 0 : chain.reduce((total, result) => total + (result.ok ? result.droppedLocators.length : 0), 0)

  const submit = () => {
    if (!parsed.ok) {
      setErrors(parsed.errors.map(({ line, message }) => ({ line, message: text.errors[message] })))
      return
    }
    const found = validationErrors(parsed.structure, source, doc, partId, names)
    if (found.length > 0) {
      setErrors(found)
      return
    }
    setErrors([])
    for (const result of chainOf(doc, partId, parsed.structure) ?? []) onEdit(result)
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="flex flex-col gap-3"
    >
      <p id={`${id}-hint`} className="text-sm text-text-muted">
        {text.hint}
      </p>
      <textarea
        aria-label={text.label}
        aria-describedby={`${id}-hint`}
        aria-invalid={errors.length > 0}
        value={source}
        rows={4}
        spellCheck={false}
        onChange={(event) => {
          setSource(event.target.value)
          setErrors([])
        }}
        className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-[15px] leading-relaxed text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-problem">
          {errors.map(({ line, message }, index) => (
            <li key={index}>{text.lineError(line, message)}</li>
          ))}
        </ul>
      )}
      <DroppedNote count={dropped} />
      <div className="flex justify-end">
        <Button type="submit" size="touch" disabled={source === initial}>
          <ActionIcon action="confirm" />
          {strings.structure.apply}
        </Button>
      </div>
    </form>
  )
}
