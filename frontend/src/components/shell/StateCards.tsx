import { TriangleAlert } from 'lucide-react'
import { type ReactNode } from 'react'
import { LogoRing } from '@/components/shell/LogoRing'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const cardClass = 'flex flex-col items-center justify-center gap-4 rounded-card border bg-surface p-8 text-center'

/** The library has nothing in it yet: a muted ring, a title, a text and an optional action (as on the States board). */
export function EmptyState({ title, text, action, className }: { title: string; text: string; action?: ReactNode; className?: string }) {
  return (
    <section className={cn(cardClass, 'border-border', className)}>
      <LogoRing size={72} className="text-border-strong" />
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="max-w-[280px] text-[15px] leading-normal text-text-soft">{text}</p>
      {action}
    </section>
  )
}

const SKELETON_WIDTHS = ['70%', '55%', '80%']

/** Cards that are still on their way: three skeleton cards and a caption saying what is loading. */
export function LoadingState({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="status"
      aria-label={strings.common.loading}
      className={cn('flex flex-col gap-3 rounded-card border border-border bg-surface p-6', className)}
    >
      {SKELETON_WIDTHS.map((width) => (
        <div key={width} className="flex flex-col gap-2.5 rounded-lg border border-surface-3 bg-background p-4">
          <Skeleton className="h-1.5 w-20 rounded-[3px] bg-surface-3 motion-reduce:animate-none" />
          <Skeleton className="h-4 rounded-lg bg-surface-3 motion-reduce:animate-none" style={{ width }} />
          <Skeleton className="h-3 w-[45%] rounded-md bg-surface-3 motion-reduce:animate-none" />
        </div>
      ))}
      <p className="mt-auto pt-3 text-center text-sm text-text-muted">{message}</p>
    </div>
  )
}

/** Something went wrong: a warning icon, a title, a text and the actions that can fix it (as on the States board). */
/** `lead` is a first line that says what went wrong before the text says why (a part that could not be read). */
export function ErrorState({ title, lead, text, actions, className }: { title: string; lead?: string; text: string; actions?: ReactNode; className?: string }) {
  return (
    <section role="alert" className={cn(cardClass, 'border-problem-border', className)}>
      <span className="flex size-14 items-center justify-center rounded-full bg-problem-bg text-problem">
        <TriangleAlert className="size-7" strokeWidth={2} aria-hidden="true" />
      </span>
      <h2 className="text-2xl font-bold">{title}</h2>
      {lead !== undefined && <p className="max-w-[300px] text-[15px] leading-normal font-semibold">{lead}</p>}
      <p className="max-w-[300px] text-[15px] leading-normal text-text-soft">{text}</p>
      {actions !== undefined && <div className="flex flex-wrap justify-center gap-3">{actions}</div>}
    </section>
  )
}
