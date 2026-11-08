import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The page's main landmark with a centred column: wide (max-w-6xl) for the Library grid, narrow (max-w-3xl) for
 * single-column screens. The padding is 32 px above and below and 40 px at the sides, as on the iPad boards (20 px
 * on a phone). Extra classes go to the column, for example gap-6 for a tighter rhythm than the default 28 px.
 */
export function PageColumn({
  width = 'wide',
  className,
  children,
}: {
  width?: 'wide' | 'narrow'
  className?: string
  children: ReactNode
}) {
  return (
    <main className="px-5 py-8 md:px-10">
      <div className={cn('mx-auto flex w-full flex-col gap-7', width === 'wide' ? 'max-w-6xl' : 'max-w-3xl', className)}>
        {children}
      </div>
    </main>
  )
}
