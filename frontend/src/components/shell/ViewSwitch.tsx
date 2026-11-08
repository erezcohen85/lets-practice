import { PencilRuler, Play } from 'lucide-react'
import { Link } from 'react-router'
import { EditorLink } from '@/components/editor/EditorLink'
import { glowClass } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.common

const segmentClass =
  'inline-flex h-10 items-center gap-2 rounded-lg ps-4 pe-5 text-[15px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
// The side you are on is filled in its own colour with a soft glow (the same pair of colours as the big buttons of the piece hub); the other side is grey.
const activeClass = cn(glowClass, 'font-semibold [--lp-glow-size:24px]')
const inactiveClass = 'font-medium text-text-soft hover:text-foreground'
const compactClass = 'w-11 justify-center ps-0 pe-0'

/**
 * The Practice / Edit switch at the end of the Practice and Editor top bars (boards: Practice.png, Editor.png). Practice is
 * teal with a filled play icon, Edit violet with the pencil and ruler; the current side is filled and has a glow, the other
 * is grey. `editHref` null is a member, who has no editing: then there is no switch at all. `compact` shows the icons alone,
 * with the names for screen readers: Practice on a phone. On a phone the Edit side opens the "bigger screen" pop-up
 * instead of the editor (`EditorLink`).
 */
export function ViewSwitch({ active, practiceHref, editHref, compact = false, className }: { active: 'practice' | 'edit'; practiceHref: string; editHref: string | null; compact?: boolean; className?: string }) {
  if (editHref === null) return null
  return (
    <div role="group" aria-label={text.viewSwitch} className={cn('inline-flex shrink-0 gap-1 rounded-card border border-border bg-surface p-1', className)}>
      <Link
        to={practiceHref}
        aria-current={active === 'practice' ? 'page' : undefined}
        className={cn(segmentClass, compact && compactClass, active === 'practice' ? cn(activeClass, 'bg-primary text-on-primary') : inactiveClass)}
      >
        <Play className="size-4 fill-current" aria-hidden="true" />
        {compact ? <span className="sr-only">{text.viewPractice}</span> : text.viewPractice}
      </Link>
      <EditorLink
        to={editHref}
        aria-current={active === 'edit' ? 'page' : undefined}
        className={cn(segmentClass, compact && compactClass, active === 'edit' ? cn(activeClass, 'bg-edit text-on-edit [--lp-glow-colour:var(--lp-edit)]') : inactiveClass)}
      >
        <PencilRuler className="size-4" aria-hidden="true" />
        {compact ? <span className="sr-only">{text.viewEdit}</span> : text.viewEdit}
      </EditorLink>
    </div>
  )
}
