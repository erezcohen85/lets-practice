import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PartsPicker } from '@/components/newpiece/PartsPicker'
import { typedName, usePartRows } from '@/components/newpiece/usePartRows'
import { useSplitChoice } from '@/components/newpiece/useSplitChoice'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { validateNewParts, validateSplitParts } from '@/domain/newPiece'
import { SPLIT_EXPIRED, type SplitProposal } from '@/domain/splitEdits'
import { type NewPartInput, type SplitUpload } from '@/lib/dataClient'
import { sentenceOf } from '@/lib/processorClient'
import { strings } from '@/strings'

// The form is its own component, so each time the dialog opens it starts with no rows.
function AddPartsForm({
  readPartName,
  proposeSplit,
  existing,
  onAdd,
  onClose,
}: {
  readPartName: (pdf: File) => Promise<string | null>
  proposeSplit: (pdf: File) => Promise<SplitProposal>
  existing: number
  onAdd: (parts: NewPartInput[], split?: SplitUpload) => Promise<void | false>
  onClose: () => void
}) {
  const rows = usePartRows(readPartName)
  const split = useSplitChoice(proposeSplit)
  const [attempted, setAttempted] = useState(false)
  const [adding, setAdding] = useState(false)
  const [failed, setFailed] = useState(false)
  // The sentence of a refusal (the local server's), shown in place of the generic text.
  const [sentence, setSentence] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)

  const formParts = rows.parts.map((part) => ({ fileName: part.file.name, name: part.name }))
  // Several parts from one PDF count once the split is confirmed (the split's own check, not the PDF rows').
  const validate = () => (split.active ? validateSplitParts(split.stage === 'confirmed', split.parts) : validateNewParts(formParts))
  // Once an add has been tried, the errors follow the rows: each one goes as soon as it is put right.
  const errors = attempted ? validate() : {}

  useEffect(() => {
    if (focusRequest === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [focusRequest])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (adding) return
    setAttempted(true)
    setFailed(false)
    const pending = split.active && split.stage !== 'confirmed' && split.stage !== 'idle'
    if (pending || Object.keys(validate()).length > 0) {
      setFocusRequest((count) => count + 1)
      return
    }
    setAdding(true)
    try {
      const chosen = split.upload()
      const added = await onAdd(
        chosen === undefined ? rows.parts.map((part) => ({ file: part.file, name: typedName(part), ...(rows.boxChecks.has(part.key) ? { boxCheck: true } : {}) })) : [],
        chosen,
      )
      // False: the plan refused it and the prompt is open. The rows stay, so the user can change them (untick Advanced Reading) and try again.
      if (added === false) {
        setAdding(false)
        return
      }
      onClose()
    } catch (error) {
      const refusal = sentenceOf(error)
      if (refusal === SPLIT_EXPIRED) split.expire()
      else {
        setSentence(refusal)
        setFailed(true)
      }
      setAdding(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={(event) => void submit(event)} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="text-xl leading-tight font-semibold">{strings.hub.addPartsTitle}</DialogTitle>
        <DialogDescription className="text-sm text-text-soft">{strings.hub.addPartsText}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <PartsPicker rows={rows} split={split} errors={errors} attempted={attempted} existing={existing} />
      </div>
      {failed && (
        <p role="alert" className="rounded-lg border border-problem-border bg-problem-bg px-4 py-3 text-sm text-problem">
          {sentence ?? strings.hub.addPartsFailed}
        </p>
      )}
      <p className="text-sm leading-[1.3] text-text-muted">{strings.hub.addPartsNote}</p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <DialogClose render={<Button type="button" variant="outline" size="touch" disabled={adding} />}>{strings.hub.cancel}</DialogClose>
        <Button type="submit" size="touch" disabled={adding}>
          <ActionIcon action="add" />
          {adding ? strings.hub.addPartsSubmitting : strings.hub.addPartsSubmit}
        </Button>
      </div>
    </form>
  )
}

/**
 * Adds PDF parts to the piece: the same rows and rules as the New piece page (a PDF each, a name each, names read from the
 * files; or the parts of one PDF that holds several, as a split). `onAdd` gets the parts in order, and the split instead of them and rejects when they could not be added; the dialog then says so and keeps the rows.
 * `existing` is how many parts the piece has already, for the plan's limit on parts. `onAdd` resolves false when the plan refused (the
 * prompt is open): the dialog then stays as it is, with no error of its own.
 */
export function AddPartsDialog({
  open,
  onOpenChange,
  readPartName,
  proposeSplit,
  existing = 0,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  readPartName: (pdf: File) => Promise<string | null>
  proposeSplit: (pdf: File) => Promise<SplitProposal>
  existing?: number
  onAdd: (parts: NewPartInput[], split?: SplitUpload) => Promise<void | false>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-card p-6 sm:max-w-lg">
        <AddPartsForm readPartName={readPartName} proposeSplit={proposeSplit} existing={existing} onAdd={onAdd} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
