import { type ReactNode } from 'react'
import { Link } from 'react-router'
import { LogoRing } from '@/components/shell/LogoRing'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

/** The logo ring and the name in tracked capitals (a notch bigger beside the large ring of the landing page). A link when `to` is given, otherwise plain branding. */
export function Wordmark({ size = 48, to, className }: { size?: number; to?: string; className?: string }) {
  const content: ReactNode = (
    <>
      <LogoRing size={size} />
      <span className={cn('font-semibold tracking-[0.22em] uppercase', size > 48 ? 'text-[15px]' : 'text-sm')}>{strings.app.name}</span>
    </>
  )
  const layout = 'inline-flex items-center gap-3'
  return to === undefined ? (
    <span className={cn(layout, className)}>{content}</span>
  ) : (
    <Link to={to} className={cn(layout, 'min-h-11', className)}>
      {content}
    </Link>
  )
}
