import { Button } from '@/components/ui/button'
import { strings } from '@/strings'

/** "All" plus one chip per owner; the page shows it only with two or more owners (ownerChips). `value` null means All. */
export function OwnerChips({
  owners,
  value,
  onChange,
}: {
  owners: string[]
  value: string | null
  onChange(owner: string | null): void
}) {
  const chip = (label: string, owner: string | null) => (
    <Button
      key={label}
      variant="outline"
      size="touch"
      aria-pressed={value === owner}
      className="rounded-full px-[18px] text-[15px] text-text-soft aria-pressed:border-border-strong aria-pressed:bg-surface-2 aria-pressed:font-medium aria-pressed:text-foreground"
      onClick={() => onChange(owner)}
    >
      {label}
    </Button>
  )
  return (
    <div role="group" aria-label={strings.library.ownerFilterLabel} className="flex flex-wrap gap-2">
      {chip(strings.library.ownerAll, null)}
      {owners.map((owner) => chip(owner, owner))}
    </div>
  )
}
