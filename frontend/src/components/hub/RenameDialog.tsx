import { useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { SuggestionNote, SuggestNameButton } from '@/components/hub/SuggestNameButton'
import { useNameSuggestion } from '@/components/hub/useNameSuggestion'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkName } from '@/domain/names'
import { type NameSuggestion } from '@/lib/processorClient'
import { strings } from '@/strings'

/** The words of one rename dialog: what it is for, and what it says when the name is refused or could not be saved. */
export interface RenameTexts {
  title: string
  label: string
  save: string
  empty: string
  /** Said for a name longer than `max`; needed when there is a `max`. */
  tooLong?: string
  failed: string
}

type Problem = 'empty' | 'too-long' | 'failed'

// The form is its own component, so each time the dialog opens it starts again from the current name.
function RenameForm({
  value,
  max,
  texts,
  onRename,
  onClose,
  suggest,
  field,
}: {
  field: RefObject<HTMLInputElement | null>
  value: string
  max: number | undefined
  texts: RenameTexts
  onRename: (name: string) => Promise<void>
  onClose: () => void
  suggest: (() => Promise<NameSuggestion>) | undefined
}) {
  const fieldId = useId()
  const messageId = useId()
  const [draft, setDraft] = useState(value)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [saving, setSaving] = useState(false)
  const suggestion = useNameSuggestion(suggest ?? (() => Promise.reject(new Error('no suggestion'))), (name) => {
    setDraft(name)
    setProblem(null)
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const checked = checkName(draft, max ?? Infinity)
    if ('problem' in checked) {
      setProblem(checked.problem)
      field.current?.focus()
      return
    }
    const next = checked.name
    if (next === value) {
      onClose()
      return
    }
    setSaving(true)
    try {
      await onRename(next)
      onClose()
    } catch {
      setProblem('failed')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="text-xl leading-tight font-semibold">{texts.title}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={fieldId} className="text-sm text-text-soft">
            {texts.label}
          </Label>
          {suggest !== undefined && <SuggestNameButton busy={suggestion.busy} disabled={saving} onClick={() => void suggestion.suggest()} className="-my-1.5" />}
        </div>
        <Input
          id={fieldId}
          ref={field}
          type="text"
          autoComplete="off"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setProblem(null)
          }}
          aria-invalid={problem === 'empty' || problem === 'too-long'}
          aria-describedby={problem === null ? undefined : messageId}
          className="h-12 bg-background px-4 text-base md:text-base dark:bg-background"
        />
        {problem !== null && (
          <p id={messageId} role="alert" className="text-sm text-problem">
            {problem === 'empty' ? texts.empty : problem === 'too-long' ? texts.tooLong : texts.failed}
          </p>
        )}
        <SuggestionNote note={suggestion.note} />
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <DialogClose render={<Button type="button" variant="outline" size="touch" disabled={saving} />}>
          {strings.hub.cancel}
        </DialogClose>
        <Button type="submit" size="touch" disabled={saving}>
          <ActionIcon action="save" />
          {texts.save}
        </Button>
      </div>
    </form>
  )
}

/**
 * Asks for a new name. Empty (or only spaces), or longer than `max` when there is one, is refused in the dialog; a failed save
 * is said there too and the dialog stays open. `onRename` gets the trimmed name and rejects when it could not be saved.
 */
export function RenameDialog({
  open,
  onOpenChange,
  value,
  max,
  texts,
  onRename,
  suggest,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  max?: number
  texts: RenameTexts
  onRename: (name: string) => Promise<void>
  /** Gives the dialog a "Suggest a name" button that fills the field with what this returns. */
  suggest?: () => Promise<NameSuggestion>
}) {
  // The field takes the focus when the dialog opens, also when "Suggest a name" comes before it in the tab order.
  const field = useRef<HTMLInputElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No built-in close button: it has a fixed English label, and Cancel and Escape already close the dialog. */}
      <DialogContent showCloseButton={false} initialFocus={field} className="gap-0 rounded-card p-6 sm:max-w-md">
        <RenameForm field={field} value={value} max={max} texts={texts} onRename={onRename} onClose={() => onOpenChange(false)} suggest={suggest} />
      </DialogContent>
    </Dialog>
  )
}
