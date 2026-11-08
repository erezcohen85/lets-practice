import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { fieldClass } from './fields'

/** A whole-number field that holds what the player typed as text; the forms turn it into a number on Apply. */
export function NumberField({
  className,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'onChange' | 'type'> & { onValueChange: (value: string) => void }) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={cn(fieldClass, 'w-20 text-center tabular-nums', className)}
      onChange={(event) => onValueChange(event.target.value)}
      {...props}
    />
  )
}
