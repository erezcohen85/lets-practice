import { useState, type MouseEvent } from 'react'
import { Link, type LinkProps } from 'react-router'
import { BiggerScreenDialog } from './BiggerScreenDialog'
import { useEditorBlocked } from './useEditorBlocked'

/**
 * A link into the editor. On a phone it looks the same, but a tap opens the "bigger screen" pop-up and stays where it is
 * (Decisions 2026-11-08); the link keeps the editor's address.
 */
export function EditorLink({ onClick, ...props }: LinkProps) {
  const blocked = useEditorBlocked()
  const [open, setOpen] = useState(false)
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (!blocked || event.defaultPrevented) return
    event.preventDefault()
    setOpen(true)
  }
  return (
    <>
      <Link {...props} onClick={click} />
      {blocked && <BiggerScreenDialog open={open} onOpenChange={setOpen} />}
    </>
  )
}
