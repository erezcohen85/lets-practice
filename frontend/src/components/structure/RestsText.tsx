import { useId, useState } from 'react'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { groupMarks, listedMarks } from '@/domain/markRanges'
import { lastRestBar, setMarks, validateMarks, type EditResult, type EditorDoc } from '@/domain/pieceEdits'
import { firstBar as firstBarOf } from '@/domain/shortBars'
import { type BarNames } from '@/domain/barNames'
import { type ListedMark } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { strings } from '@/strings'
import { structureErrorText } from './fields'

const text = strings.structure.text
// Bars are labels: "46", or "p7" for a pickup.
const RANGE = /^(p?\d+)(?:\s*[-–]\s*(p?\d+))?$/i

/** "46-48, 101" as rest marks, one per bar; null when a piece of it is not a bar or a range, or names a bar the piece does not have (p9 with no such pickup). */
function parseRests(source: string, names: BarNames): ListedMark[] | null {
  const marks: ListedMark[] = []
  for (const piece of source.split(',').map((part) => part.trim()).filter((part) => part !== '')) {
    const found = RANGE.exec(piece)
    if (found === null) return null
    const from = names.parse(found[1])
    const to = found[2] === undefined ? from : names.parse(found[2])
    if (from === null || to === null || to < from) return null
    for (let bar = from; bar <= to; bar++) marks.push({ bar, kind: 'rest' })
  }
  return marks
}

/** This part > Rests as one line of text ("46-48, 101"), the rests of the open part only; the piece's marks are kept. */
export function RestsText({ doc, partId, partName, onEdit }: { doc: EditorDoc; partId: string; partName: string; onEdit: (result: EditResult) => void }) {
  const id = useId()
  const names = useBarNames()
  const page = doc.pages.find((existing) => existing.partId === partId)
  const marks = listedMarks(doc.timing, page)
  const [initial] = useState(() =>
    groupMarks(marks.filter((mark) => mark.kind === 'rest'))
      .map((range) => (range.from === range.to ? names.label(range.from) : `${names.label(range.from)}-${names.label(range.to)}`))
      .join(', '),
  )
  const [source, setSource] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const rests = parseRests(source, names)
    if (rests === null) return setError(text.restsBad)
    const restLast = lastRestBar(doc.timing, page)
    const firstBar = firstBarOf(doc.timing)
    const problems = validateMarks(rests, doc.timing.barCount, firstBar, restLast)
    if (problems.length > 0) return setError(structureErrorText(problems[0], names.label(restLast), names.label(firstBar)))
    setError(null)
    const result = setMarks(doc, [...marks.filter((mark) => mark.kind !== 'rest'), ...rests], partId)
    if (result.ok) onEdit(result)
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
        {text.restsHint(partName)}
      </p>
      <input
        type="text"
        aria-label={text.restsLabel}
        aria-describedby={`${id}-hint`}
        aria-invalid={error !== null}
        value={source}
        spellCheck={false}
        onChange={(event) => {
          setSource(event.target.value)
          setError(null)
        }}
        className="w-full rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-[15px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      {error !== null && (
        <p role="alert" className="text-sm text-problem">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="touch" disabled={source === initial}>
          <ActionIcon action="confirm" />
          {strings.structure.apply}
        </Button>
      </div>
    </form>
  )
}
