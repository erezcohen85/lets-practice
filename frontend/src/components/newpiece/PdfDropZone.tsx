import { Upload } from 'lucide-react'
import { useId, useState, type ChangeEvent, type DragEvent } from 'react'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

/**
 * The dashed area that is also the PDF picker: a click opens the file dialog, and PDFs dropped on it are handed on
 * together with anything else that came along. The real input stays in the page, hidden but focusable, so the keyboard
 * and screen readers get an ordinary file field named after the visible text.
 */
export function PdfDropZone({
  onFiles,
  invalid,
  describedBy,
  label = strings.newPiece.dropZone,
  hint,
  multiple = true,
}: {
  onFiles: (files: File[]) => void
  invalid: boolean
  describedBy?: string
  /** The text in the area, which also names the file field. */
  label?: string
  /** A second, quieter line under the text: what the area takes (the file types and limits). It also describes the file field. */
  hint?: string
  /** One PDF only (the PDF that holds all the parts). */
  multiple?: boolean
}) {
  const [dragging, setDragging] = useState(false)
  const hintId = useId()
  const described = [describedBy, hint === undefined ? null : hintId].filter(Boolean).join(' ')

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onFiles(Array.from(event.currentTarget.files ?? []))
    // So that choosing the same file again (after removing its row) still counts as a change.
    event.currentTarget.value = ''
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    onFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <label
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'flex min-h-30 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-border-strong bg-surface/50 px-4 text-center text-base text-text-soft transition-colors hover:border-primary-strong/60',
        'has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-aria-invalid:border-problem',
        dragging && 'border-primary-strong bg-surface-2',
      )}
    >
      <Upload className="size-7 text-primary-strong" strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
      {hint !== undefined && (
        <span id={hintId} className="text-[13px] leading-[18px] text-text-muted">
          {hint}
        </span>
      )}
      <input
        type="file"
        accept="application/pdf"
        multiple={multiple}
        className="sr-only"
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={described === '' ? undefined : described}
        onChange={handleChange}
      />
    </label>
  )
}
