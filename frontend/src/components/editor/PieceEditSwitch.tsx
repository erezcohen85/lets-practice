import { Hint } from '@/components/ui/hint'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'
import { type PieceEditingApi } from './usePieceEditing'

const t = strings.editor.pieceEditing

/**
 * The "Edit piece structure" switch: turning it on asks first (the warning); while it is on, a minute without input asks
 * "Still editing the piece?" beside it.
 */
export function PieceEditSwitch({ editing, partName }: { editing: PieceEditingApi; partName: string }) {
  const { on, askedAtMs } = editing.state
  return (
    <div className="relative flex shrink-0 items-center gap-2 border-s border-border ps-2.5 @max-[679px]:border-s-0 @max-[679px]:ps-0">
      {/* The word stays "Edit piece" in both states; on, the switch is red and the word is pink, so the colour is not the only sign. */}
      <span aria-hidden className={cn('text-sm', on ? 'text-problem' : 'text-text')}>
        {t.switchShort}
      </span>
      <Hint text={t.switch}>
        <Switch checked={on} tone="danger" onCheckedChange={(checked) => (checked ? editing.requestOn() : editing.turnOff())} aria-label={t.switch} />
      </Hint>
      {on && askedAtMs !== null && (
        <div role="status" className="absolute top-full end-0 z-20 mt-2 flex items-center gap-2 rounded-card border border-border bg-surface-2 px-3 py-2 shadow-lg">
          <span className="text-sm whitespace-nowrap text-text">{t.idleAsk}</span>
          <Button size="sm" onClick={editing.keep}>
            <ActionIcon action="edit" />
            {t.keep}
          </Button>
          <Button size="sm" variant="outline" onClick={editing.turnOff}>
            {t.turnOff}
          </Button>
        </div>
      )}
      <AlertDialog open={editing.asking} onOpenChange={(open) => !open && editing.cancelRequest()}>
        <AlertDialogContent className="gap-5 rounded-card p-6 data-[size=default]:sm:max-w-md">
          <AlertDialogHeader className="place-items-start gap-2 text-start">
            <AlertDialogTitle className="text-xl leading-tight font-semibold">{t.warningTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-[15px] text-text-soft">{t.warningText(partName)}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <AlertDialogCancel size="touch">{strings.hub.cancel}</AlertDialogCancel>
            <AlertDialogAction
              size="touch"
              onClick={editing.turnOn}
            >
              <ActionIcon action="confirm" />
              {t.turnOn}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
