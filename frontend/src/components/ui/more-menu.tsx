import { Menu } from '@base-ui/react/menu'
import { EllipsisVertical, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The panel and item looks of a Base UI menu, shared with the account menu in the top bar. */
export const MENU_POPUP_CLASS =
  'flex w-45 flex-col gap-0.5 rounded-lg border border-border-strong bg-surface-2 p-1.5 shadow-[0_12px_32px_color-mix(in_oklab,var(--lp-ink)_45%,transparent)] outline-none'
export const MENU_ITEM_CLASS =
  'flex h-11 cursor-default items-center gap-2.5 rounded-(--lp-radius-sm) px-3.5 text-[15px] font-medium outline-none select-none data-disabled:opacity-50 data-highlighted:bg-surface-3'

export interface MoreMenuItem {
  label: string
  icon: LucideIcon
  onSelect(): void
  /** Draws the item in the problem colour, for Delete and the like. */
  danger?: boolean
  disabled?: boolean
}

/**
 * The three-dot menu of a title row, a part row or a card (boards: Hub.png CHANGES 1). A 44 px button that opens a
 * 180 px panel of items, each with an icon. Base UI's Menu does the rest: arrow keys, Escape, a click outside, and the
 * focus back on the button. `label` names the button for screen readers ("More for <title>"). The panel is drawn in a
 * portal, so a card or a row that clips its content does not clip the menu.
 */
export function MoreMenu({ label, items, className }: { label: string; items: MoreMenuItem[]; className?: string }) {
  return (
    // Not modal: the page keeps its scroll bar, and the menu still closes on a click outside.
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label={label}
        className={cn(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-soft outline-none transition-colors hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-surface-2',
          className,
        )}
      >
        <EllipsisVertical className="size-[22px]" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Menu.Popup className={MENU_POPUP_CLASS}>
            {items.map(({ label: itemLabel, icon: Icon, onSelect, danger = false, disabled = false }) => (
              <Menu.Item
                key={itemLabel}
                disabled={disabled}
                onClick={onSelect}
                className={cn(
                  MENU_ITEM_CLASS,
                  danger ? 'text-problem' : 'text-text',
                )}
              >
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                {itemLabel}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
