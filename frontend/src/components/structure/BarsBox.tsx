import { cn } from '@/lib/utils'

/** One of the two boxes of a Bars tab: a title and a card. Greyed out and not clickable while the tab is locked. */
export function BarsBox({ title, locked = false, className, children }: { title: string; locked?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('flex min-w-0 flex-1 basis-80 flex-col gap-2 self-start', locked && 'pointer-events-none opacity-45', className)}>
      <h3 className="text-[13px] font-semibold text-text-muted">{title}</h3>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background px-5 py-4">{children}</div>
    </section>
  )
}
