import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const t = strings.suggestName

/** A small button beside a title field; the note goes under the field (SuggestionNote). */
export function SuggestNameButton({ busy, disabled, onClick, className }: { busy: boolean; disabled?: boolean; onClick: () => void; className?: string }) {
  return (
    <Button type="button" variant="ghost" size="sm" disabled={busy || disabled} onClick={onClick} className={cn('h-9 gap-1.5 px-3 text-primary-strong hover:text-primary-strong', className)}>
      <Sparkles className="size-4" strokeWidth={2} aria-hidden="true" />
      {busy ? t.busy : t.button}
    </Button>
  )
}

/** What the suggestion says about itself, when it was not made by the model or could not be made. */
export function SuggestionNote({ note, id }: { note: string | null; id?: string }) {
  return note === null ? null : (
    <p id={id} role="status" className="text-sm text-text-muted">
      {note}
    </p>
  )
}
