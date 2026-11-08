import { type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// BRAND EXCEPTION to "no raw colours in components" (Decisions 2026-11-06, Rulings needed): Google's sign-in button has a
// fixed look that Google's brand rules ask us to keep as is, so its white, grey and four-colour G are not design tokens.
// They live in this one file, which design/no-raw-colours.test.ts lists by name. Nothing else may copy them.
const GOOGLE_BLUE = '#4285F4'
const GOOGLE_GREEN = '#34A853'
const GOOGLE_YELLOW = '#FBBC05'
const GOOGLE_RED = '#EA4335'

/** The four-colour Google "G", 18 px. Decorative: the button's label is its name. */
export function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('size-[18px]', className)} aria-hidden="true">
      <path
        fill={GOOGLE_YELLOW}
        d="M10.5 28.7A14 14 0 0 1 9.8 24c0-1.6.3-3.2.7-4.7l-8-6.2A24 24 0 0 0 0 24c0 3.9.9 7.5 2.5 10.8l8-6.1z"
      />
      <path
        fill={GOOGLE_RED}
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.2l8 6.2C12.4 13.7 17.7 9.5 24 9.5z"
      />
      <path
        fill={GOOGLE_GREEN}
        d="M24 48c6.5 0 12-2.1 16-5.8l-7.8-6c-2.2 1.5-5 2.4-8.2 2.4-6.3 0-11.6-4.2-13.5-9.9l-8 6.1C6.4 42.6 14.5 48 24 48z"
      />
      <path
        fill={GOOGLE_BLUE}
        d="M47.5 24.5c0-1.6-.1-3.2-.4-4.5H24v9h13.2c-.6 3-2.3 5.5-4.8 7.2l7.8 6c4.5-4.2 7.3-10.4 7.3-17.7z"
      />
    </svg>
  )
}

/**
 * The hero's sign-in button: white with a grey border and dark text, the G at its start, 52 px high. It keeps the app
 * button's glow (the primary colour at 25 %), so it sits beside the teal one as drawn.
 */
export function GoogleSignInButton({ className, children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      size="xl"
      className={cn(
        'h-13 gap-2 border-[#DADCE0] bg-[#FFFFFF] px-2.5 text-sm font-semibold text-[#1F1F1F] hover:bg-[#F8F9FA] hover:text-[#1F1F1F]',
        className,
      )}
      {...props}
    >
      <GoogleG />
      {children}
    </Button>
  )
}
