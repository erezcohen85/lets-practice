import { Input } from '@/components/ui/input'
import { strings } from '@/strings'

const text = strings.dock

const FIELD_WIDTH = 96

export interface RelabelFieldProps {
  /** The line's x in the dock; the field sits on it. */
  x: number
  /** The dock's width, so the field stays inside it. */
  width: number
  value: string
  /** Why the typed label was not applied; null while there is nothing to say. */
  error: string | null
  onChange(value: string): void
  onSubmit(): void
  /** Escape. */
  onCancel(): void
  /** Focus left the field. */
  onBlur(): void
}

/** The small text field on a locator line for typing its bar number ("12", or "12 (2)"). Enter applies, Escape or leaving the field cancels. */
export function RelabelField({ x, width, value, error, onChange, onSubmit, onCancel, onBlur }: RelabelFieldProps) {
  return (
    <div
      data-slot="dock-relabel"
      className="absolute z-10 flex flex-col gap-1"
      style={{ left: Math.max(0, Math.min(x, width - FIELD_WIDTH)), top: 4, width: FIELD_WIDTH }}
    >
      <Input
        autoFocus
        aria-label={text.relabelField}
        aria-invalid={error !== null}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            onSubmit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
        className="h-7 bg-surface px-2 text-sm"
      />
      {error !== null && (
        <p role="alert" className="w-60 rounded-md bg-surface-3 px-2 py-1 text-xs text-problem">
          {error}
        </p>
      )}
    </div>
  )
}
