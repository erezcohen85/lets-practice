import { Tooltip } from '@base-ui/react/tooltip'
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** How long the pointer rests on a control before its hover text shows (ms). Keyboard focus shows it at once. */
export const HINT_DELAY_MS = 350

/**
 * Hover text in the app's look: a raised surface with a strong border, the More menu's style, instead of the browser's
 * slow grey title. The trigger is a span around the control, so the text also shows on a disabled control (a disabled
 * button takes no pointer, the span does) and can say why it is off. The span takes no Tab stop: focus on the control
 * inside shows the text too.
 */
export function Hint({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={HINT_DELAY_MS} render={<span data-slot="hint" data-hint={text} className={cn('inline-flex', className)} />}>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6} collisionPadding={8} className="z-50">
          <Tooltip.Popup className="max-w-72 rounded-md border border-border-strong bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-text shadow-[0_8px_24px_color-mix(in_oklab,var(--lp-ink)_40%,transparent)]">
            {text}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** The hover text a control carries, read from its Hint; null without one. */
export function hintOf(element: Element): string | null {
  return element.closest('[data-slot="hint"]')?.getAttribute('data-hint') ?? null
}
