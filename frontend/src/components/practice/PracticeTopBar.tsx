import { BackLink } from '@/components/shell/BackLink'
import { ViewSwitch } from '@/components/shell/ViewSwitch'
import { usePhoneLayout } from './usePhoneLayout'

/** The top bar of Practice (board: Practice.png): the way back (to the hub, or to the home page in the demo), the title, the part as a chip (its menu is in the toolbar; it shortens with an ellipsis when the bar is narrow) and the Practice / Edit switch (one line from `sm`, may wrap below), whose Edit side carries the bar the cursor is in (`editHref` is null for a member, who has no switch). */
export function PracticeTopBar({ back, title, partName, practiceHref, editHref }: { back: { to: string; label: string }; title: string; partName: string; practiceHref: string; editHref: string | null }) {
  const phone = usePhoneLayout()
  // On a phone one row: the part's name is in the part menu, and the switch shrinks to its icons.
  if (phone) {
    return (
      <header className="flex items-center gap-x-2 py-1">
        <BackLink to={back.to}>{back.label}</BackLink>
        <h1 className="line-clamp-2 min-w-0 flex-1 text-base leading-tight font-bold">{title}</h1>
        <ViewSwitch active="practice" practiceHref={practiceHref} editHref={editHref} compact className="ms-auto p-0.5" />
      </header>
    )
  }
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:flex-nowrap">
      <BackLink to={back.to}>{back.label}</BackLink>
      <h1 className="min-w-0 truncate text-lg font-bold">{title}</h1>
      <span
        data-slot="part-chip"
        className="inline-flex h-10 max-w-56 min-w-0 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium whitespace-nowrap text-text"
      >
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary-strong" />
        <span className="truncate">{partName}</span>
      </span>
      <ViewSwitch active="practice" practiceHref={practiceHref} editHref={editHref} className="ms-auto" />
    </header>
  )
}
