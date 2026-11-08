import { ChevronLeft } from 'lucide-react'
import { type ReactNode } from 'react'
import { Link } from 'react-router'
import { strings } from '@/strings'

/** The way back at the start of a screen's top row: a chevron that flips in a right-to-left page, and a label. */
export function BackLink({ to = '/library', children = strings.common.backToLibrary }: { to?: string; children?: ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-11 items-center gap-2 text-base whitespace-nowrap text-text-soft transition-colors hover:text-foreground">
      <ChevronLeft className="size-5 rtl:rotate-180" aria-hidden="true" />
      {children}
    </Link>
  )
}
