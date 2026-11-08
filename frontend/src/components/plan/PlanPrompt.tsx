import { useState } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { strings } from '@/strings'

/**
 * The "Not in your plan" prompt (plans and limits): a title, one sentence naming the limit and what the user can do, one OK
 * button. It opens when `prompt` is set and calls `onClose` for OK, Escape and a click outside. The words of the last prompt
 * stay while the dialog fades out, so it never flashes empty. Later the OK leads to a payment screen; it is only OK now.
 */
export function PlanPrompt({ prompt, onClose }: { prompt: { title: string; sentence: string } | null; onClose: () => void }) {
  const [last, setLast] = useState(prompt)
  if (prompt !== null && (last === null || last.title !== prompt.title || last.sentence !== prompt.sentence)) setLast(prompt)
  const words = prompt ?? last

  return (
    <AlertDialog open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="gap-5 rounded-card p-6 data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="place-items-start gap-2 text-start">
          <AlertDialogTitle className="text-xl leading-tight font-semibold">{words?.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[15px] text-text-soft break-words">{words?.sentence}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex justify-end">
          <AlertDialogAction size="touch" className="min-w-24 px-6" onClick={onClose}>
            {strings.plans.ok}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
