import { SettingSwitch } from '@/components/settings/SettingSwitch'
import { strings } from '@/strings'

/** A switch that also says On or Off in words beside it: colour is never the only signal. */
export function StateSwitch({
  checked,
  onChange,
  label,
  labelledBy,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  /** The accessible name, when no element names the switch. */
  label?: string
  labelledBy?: string
  className?: string
}) {
  return (
    <div className={className ?? 'flex items-center gap-2.5'}>
      <SettingSwitch checked={checked} onCheckedChange={onChange} aria-label={label} aria-labelledby={labelledBy} />
      <span className="w-7 text-sm font-semibold text-foreground">{checked ? strings.admin.on : strings.admin.off}</span>
    </div>
  )
}
