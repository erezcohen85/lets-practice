import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { strings } from '@/strings'

const text = strings.editor.phone

/** The pop-up a phone gets instead of the editor: the editor needs a bigger screen. Back, its only button, closes it. */
export function BiggerScreenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gap-5 rounded-card p-6 data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="place-items-start gap-2 text-start">
          <AlertDialogTitle className="text-xl leading-tight font-semibold">{text.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[15px] leading-normal text-text-soft">{text.text}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col sm:flex-row sm:justify-end">
          <AlertDialogCancel size="touch">{text.back}</AlertDialogCancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
