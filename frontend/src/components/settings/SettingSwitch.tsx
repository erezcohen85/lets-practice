import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'

/**
 * The switch of the Settings board: 52 by 30 px with a 22 px thumb, bigger than the shadcn default so it is easy to
 * hit on an iPad. It is built on the same Base UI switch as components/ui/switch.tsx, which cannot be sized from the
 * outside because its thumb takes no class. The invisible padding of the ::after makes the touch target 76 by 46 px.
 */
export function SettingSwitch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-[30px] w-[52px] shrink-0 items-center rounded-full p-1 transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-primary-strong data-unchecked:bg-border data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[22px] rounded-full transition-transform data-checked:translate-x-[22px] data-checked:bg-surface dark:data-checked:bg-on-primary data-unchecked:bg-text-muted rtl:data-checked:-translate-x-[22px]" />
    </SwitchPrimitive.Root>
  )
}
