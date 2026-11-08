import { ChevronDown } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { usePhoneLayout } from './usePhoneLayout'

export const toolbarButtonClass =
  'inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 text-[15px] font-medium whitespace-nowrap text-text outline-none transition-colors hover:bg-surface-3 focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * A toolbar button that opens a panel above it (the toolbar sits at the foot of the screen): Escape and a press outside
 * close it. 'menu' holds one-choice items (MenuChoice); 'dialog' holds a mix of controls and stays open until closed.
 * The button's name is its visible text. On a phone the panel sits at the foot of the window instead, so a button near the
 * edge does not push it off the screen, and it scrolls if it is taller than the window, leaving a strip above to press.
 */
export function ToolbarMenu({
  label,
  panelLabel,
  panelRole = 'menu',
  chevron = true,
  toggle,
  className,
  panelClassName,
  children,
}: {
  label: ReactNode
  panelLabel: string
  panelRole?: 'menu' | 'dialog'
  chevron?: boolean
  /**
   * Splits the button in two, like the Loop button: the label side switches a setting on and off (aria-pressed), and the
   * arrow beside it opens the panel. `arrowLabel` names the arrow.
   */
  toggle?: { pressed: boolean; onToggle(): void; arrowLabel: string }
  className?: string
  panelClassName?: string
  /** The panel's content; a function gets the close callback, for a choice that closes the menu. */
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const phone = usePhoneLayout()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const close = () => setOpen(false)
  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        // The page's own Escape (cancel a pick) must not also run.
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
      }}
    >
      {toggle ? (
        <div
          className={cn(
            'inline-flex min-h-11 items-center rounded-lg border text-[15px] font-medium whitespace-nowrap',
            toggle.pressed ? 'border-primary-strong/60 bg-surface-2 text-primary-strong' : 'border-border bg-surface-2 text-text-soft',
            className,
          )}
        >
          <button
            type="button"
            aria-pressed={toggle.pressed}
            onClick={toggle.onToggle}
            className="inline-flex min-h-11 items-center gap-2 rounded-s-lg ps-4 pe-2 outline-none hover:bg-surface-3 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {label}
          </button>
          <button
            ref={buttonRef}
            type="button"
            aria-label={toggle.arrowLabel}
            aria-haspopup={panelRole}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen(!open)}
            className="inline-flex min-h-11 items-center rounded-e-lg ps-1 pe-3 outline-none hover:bg-surface-3 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronDown className="size-4 shrink-0 text-text-soft" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup={panelRole}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen(!open)}
          className={cn(toolbarButtonClass, 'w-full', className)}
        >
          {label}
          {chevron && <ChevronDown className="size-4 shrink-0 text-text-soft" aria-hidden="true" />}
        </button>
      )}
      {open && (
        <div
          id={panelId}
          role={panelRole}
          aria-label={panelLabel}
          className={cn(
            phone ? 'fixed inset-x-2 bottom-2 z-30 mx-auto max-h-[calc(100dvh-4rem)] overflow-y-auto' : 'absolute start-0 bottom-full z-20 mb-2',
            'flex min-w-48 flex-col gap-0.5 rounded-card border border-border bg-surface p-1 shadow-lg',
            panelClassName,
            phone && 'w-auto max-w-md min-w-0',
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

/** One choice of a menu: a radio item with the current one marked and in the primary colour. */
export function MenuChoice({
  checked,
  role = 'menuitemradio',
  onChoose,
  children,
}: {
  checked: boolean
  role?: 'menuitemradio' | 'radio'
  onChoose(): void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      onClick={onChoose}
      className={cn(
        'flex min-h-11 items-center rounded-lg px-3 text-start text-[15px] outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50',
        checked ? 'font-semibold text-primary-strong' : 'text-text',
      )}
    >
      {children}
    </button>
  )
}
