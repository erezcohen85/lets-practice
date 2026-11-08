import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { strings } from '@/strings'

const text = strings.settings

const groups = (['both', 'editor'] as const).map((group) => ({
  group,
  title: text.shortcutGroups[group],
  rows: text.shortcuts.filter((row) => row.group === group),
}))

/** How many Editor-only entries there are besides Next problem, which the row's hint names itself. */
export const MORE_EDITOR_SHORTCUTS = text.shortcuts.filter((row) => row.group === 'editor').length - 1

/**
 * The keys of Practice and the Editor, read only (Erez, 2026-11-06): what each key does today, in two groups. The list
 * scrolls inside the dialog on a short screen, with the title above and Done below always in view. Esc, the scrim and Done close it.
 */
export function KeyboardShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 rounded-(--lp-radius-lg) p-6 sm:max-w-[560px]"
      >
        <DialogTitle className="text-[22px] leading-7 font-bold">{text.keyboardShortcuts}</DialogTitle>
        {/* Every group is a list the reader can step through; the scrolling part is focusable so the keys scroll it. */}
        <div tabIndex={0} className="-mx-1 mt-4 flex min-h-0 flex-col gap-5 overflow-y-auto px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {groups.map(({ group, title, rows }) => (
            <section key={group} aria-label={title} className="flex flex-col">
              <h3 className="mb-1 text-[13px] font-semibold tracking-[0.06em] text-text-muted uppercase">{title}</h3>
              <ul className="flex flex-col">
                {rows.map((row) => (
                  <li key={row.action} className="flex min-h-12 items-center justify-between gap-4 border-b border-border px-1 py-2">
                    <span className="text-[15px] leading-5">{row.action}</span>
                    <kbd className="inline-flex h-9 min-w-[72px] shrink-0 items-center justify-center rounded-lg border border-border-strong bg-background px-3 font-sans text-[13px] font-bold whitespace-nowrap">
                      {row.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <DialogClose render={<Button size="touch" className="px-6 font-semibold" />}>{text.shortcutsDone}</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
