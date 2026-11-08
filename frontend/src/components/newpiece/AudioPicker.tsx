import { FileAudio, Upload } from 'lucide-react'
import { useId, useState, type ChangeEvent, type DragEvent } from 'react'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const AUDIO_NAME = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aif|aiff|webm)$/i

function isAudio(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_NAME.test(file.name)
}

/**
 * The audio file field, a dashed drop area like the PDF one (Erez, 2026-11-03): a click opens the file dialog and an
 * audio file dropped on it is taken (the first one, when several come). It shows the chosen file's name. The real input
 * stays in the page, hidden but focusable.
 */
export function AudioPicker({
  file,
  onChange,
  invalid,
  errorId,
}: {
  file: File | null
  onChange: (file: File | null) => void
  invalid: boolean
  errorId?: string
}) {
  const nameId = useId()
  const [dragging, setDragging] = useState(false)
  const describedBy = [file === null ? null : nameId, errorId].filter(Boolean).join(' ')

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    // Cancelling the dialog keeps the file that was chosen before.
    const chosen = event.currentTarget.files?.[0]
    if (chosen !== undefined) onChange(chosen)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    const dropped = Array.from(event.dataTransfer.files).find(isAudio)
    if (dropped !== undefined) onChange(dropped)
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
      {file === null ? (
        <>
          <Upload className="size-7 text-primary-strong" strokeWidth={1.8} aria-hidden="true" />
          <span>{strings.newPiece.audioDropZone}</span>
        </>
      ) : (
        <span className="flex max-w-full items-center gap-2">
          <FileAudio className="size-5 shrink-0 text-primary-strong" aria-hidden="true" />
          <span id={nameId} className="min-w-0 truncate text-foreground">
            {file.name}
          </span>
        </span>
      )}
      <input
        type="file"
        accept="audio/*"
        className="sr-only"
        aria-label={strings.newPiece.audioChoose}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        onChange={handleChange}
      />
    </label>
  )
}
