import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.admin.bar

/**
 * The bar under the tabs, sticky: how many changes wait, and the two buttons that act on all of them (both tabs share one draft).
 * `tone` is only a second signal; the words say it all.
 */
export function SaveBar({
  message,
  tone,
  dirty,
  busy,
  onDiscard,
  onSave,
}: {
  message: string
  tone: 'normal' | 'problem'
  dirty: boolean
  busy: boolean
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <section
      aria-label={text.label}
      className={cn(
        'sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-lg border bg-surface-2 py-3 ps-[18px] pe-3 shadow-lg',
        dirty ? 'border-primary-strong' : 'border-border-strong',
      )}
    >
      <span role="status" className={cn('flex items-center gap-2.5 text-[15px] leading-5 font-semibold', tone === 'problem' ? 'text-problem' : dirty ? 'text-foreground' : 'text-text-soft')}>
        {dirty && <span aria-hidden="true" className="size-2.5 rounded-full bg-primary-strong" />}
        {message}
      </span>
      <div className="flex gap-2.5">
        <Button type="button" variant="outline" size="touch" disabled={!dirty || busy} onClick={onDiscard}>
          {text.discard}
        </Button>
        <Button type="button" size="touch" disabled={!dirty || busy} onClick={onSave}>
          {text.save}
        </Button>
      </div>
    </section>
  )
}
