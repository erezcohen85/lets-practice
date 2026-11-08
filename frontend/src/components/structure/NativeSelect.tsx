import { cn } from '@/lib/utils'
import { fieldClass } from './fields'

/** The browser's own select, drawn like the other 44 px fields: a short fixed list needs no custom menu. */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        fieldClass,
        'rounded-lg border border-input text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}
