import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// The glow of a filled coloured button: the button's own colour at --lp-glow-alpha (25 % in dark, 70 % in light, palette
// A1), spread by --lp-glow-size, which is --lp-glow-reach (40 px dark, 28 px light) until a size sets it. The size steps
// down with the button (each size sets it below): 40 px around a 28 px button would only smear. It is a box-shadow made
// the Tailwind way, so the focus ring (also a box-shadow) is drawn on top of it and not instead of it. The Practice and
// Edit map links of the piece hub use it too, in their own colour (--lp-glow-colour). A pressed toggle (aria-pressed)
// has none: it says which one is on, it does not ask to be clicked.
export const glowClass =
  "shadow-[0_0_var(--lp-glow-size,var(--lp-glow-reach))_color-mix(in_oklab,var(--lp-glow-colour,var(--lp-primary))_var(--lp-glow-strength,var(--lp-glow-alpha)),transparent)]"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: `${glowClass} bg-primary text-primary-foreground hover:bg-primary/80 hover:[--lp-glow-strength:var(--lp-glow-alpha-hover)] disabled:[--lp-glow-strength:0%] data-disabled:[--lp-glow-strength:0%] aria-pressed:[--lp-glow-size:0px]`,
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        // Solid red with white text, for what cannot be undone (Reset link, Remove). The tinted `destructive` stays for quiet uses.
        danger:
          "bg-danger text-on-danger hover:bg-danger/90 focus-visible:border-danger/40 focus-visible:ring-danger/30",
        link: "text-primary-strong underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 [--lp-glow-size:18px] has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs [--lp-glow-size:10px] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] [--lp-glow-size:14px] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 [--lp-glow-size:20px] has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        touch:
          "h-11 gap-2 px-4 text-[15px] [--lp-glow-size:28px] has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3",
        xl: "h-12 gap-2 px-6 text-base font-semibold [--lp-glow-size:40px] has-data-[icon=inline-end]:pe-5 has-data-[icon=inline-start]:ps-5 [&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-8 [--lp-glow-size:0px]",
        "icon-xs":
          "size-6 [--lp-glow-size:0px] rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 [--lp-glow-size:0px] rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9 [--lp-glow-size:0px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
