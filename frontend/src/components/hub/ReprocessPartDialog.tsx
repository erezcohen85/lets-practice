import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { BoxCheckAdvanced } from '@/components/newpiece/BoxCheckAdvanced'
import { usePlanGate } from '@/lib/plan'
import { sentenceOf } from '@/lib/processorClient'
import { strings } from '@/strings'
import { ActionIcon } from '@/components/ui/action-icon'

const t = strings.partReprocess

// The body is its own component, so each time the dialog opens it starts with the tick off and no error.
function ReprocessBody({ name, note, onReprocess }: { name: string; note?: string; onReprocess: (boxCheck: boolean) => Promise<void | false> }) {
  const gate = usePlanGate()
  const [boxCheck, setBoxCheck] = useState(false)
  const [starting, setStarting] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const confirm = async () => {
    setStarting(true)
    setFailed(null)
    try {
      // False: the plan refused it and the prompt is open; the question stays, with no error of its own.
      if ((await onReprocess(boxCheck)) === false) setStarting(false)
    } catch (error) {
      setFailed(sentenceOf(error) ?? t.failed)
      setStarting(false)
    }
  }

  return (
    <>
      <AlertDialogHeader className="place-items-start gap-2 text-start">
        <AlertDialogTitle className="text-xl leading-tight font-semibold break-words">{t.title(name)}</AlertDialogTitle>
        <AlertDialogDescription className="text-[15px] text-text-soft">{t.text}</AlertDialogDescription>
        {note !== undefined && <p className="text-[15px] text-text-soft">{note}</p>}
      </AlertDialogHeader>
      <BoxCheckAdvanced
        entries={[{ key: 0, name }]}
        checked={new Set(boxCheck ? [0] : [])}
        onToggle={() => {
          // Ticking asks the plan; unticking never does.
          if (!boxCheck && !gate.check({ type: 'advancedReading', parts: 1 })) return
          setBoxCheck((on) => !on)
        }}
      />
      {failed !== null && (
        <p role="alert" className="text-sm text-problem">
          {failed}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <AlertDialogCancel size="touch" disabled={starting}>
          {strings.hub.cancel}
        </AlertDialogCancel>
        <AlertDialogAction
          size="touch"
          disabled={starting}
          onClick={(event) => {
            // The alert dialog would close itself on the click; the app leaves for the processing screen once the job has started.
            event.preventDefault()
            void confirm()
          }}
        >
          <ActionIcon action="retry" />
          {t.submit}
        </AlertDialogAction>
      </div>
    </>
  )
}

/**
 * Asks before a part is read again from its PDF (its boxes and edits are replaced; nothing else is). The Advanced tick is
 * the part's box check. `onReprocess` gets the tick and rejects when the job could not be started; the dialog then says so
 * (the server's own sentence when it gave one) and stays open. It resolves false when the plan refused (the prompt is open).
 * `note` is a line under the question, such as how many reprocesses the part has left.
 */
export function ReprocessPartDialog({
  open,
  onOpenChange,
  name,
  note,
  onReprocess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  note?: string
  onReprocess: (boxCheck: boolean) => Promise<void | false>
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gap-5 rounded-card p-6 data-[size=default]:sm:max-w-md">
        <ReprocessBody name={name} note={note} onReprocess={onReprocess} />
      </AlertDialogContent>
    </AlertDialog>
  )
}
