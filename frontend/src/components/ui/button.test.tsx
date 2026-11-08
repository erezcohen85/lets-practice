import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button, buttonVariants, glowClass } from '@/components/ui/button'

describe('the glow of a filled coloured button', () => {
  it('is on the default variant, scaled to the size, and on no other variant', () => {
    expect(buttonVariants({ size: 'xl' })).toContain(glowClass)
    expect(buttonVariants({ size: 'xl' })).toContain('[--lp-glow-size:40px]')
    expect(buttonVariants({ size: 'touch' })).toContain('[--lp-glow-size:28px]')
    expect(buttonVariants({ size: 'sm' })).toContain('[--lp-glow-size:14px]')
    for (const variant of ['outline', 'secondary', 'ghost', 'destructive', 'link'] as const) {
      expect(buttonVariants({ variant })).not.toContain(glowClass)
    }
  })

  it('takes its strength and reach from the theme (palette A1: stronger and tighter in light), not from a fixed number', () => {
    expect(glowClass).toContain('var(--lp-glow-size,var(--lp-glow-reach))')
    expect(glowClass).toContain('var(--lp-glow-strength,var(--lp-glow-alpha))')
    expect(buttonVariants({})).toContain('hover:[--lp-glow-strength:var(--lp-glow-alpha-hover)]')
    expect(glowClass).not.toContain('25%')
    expect(glowClass).not.toContain('40px')
  })

  it('is off on icon-only sizes, on a disabled button and on a pressed toggle', () => {
    expect(buttonVariants({ size: 'icon' })).toContain('[--lp-glow-size:0px]')
    expect(buttonVariants({ size: 'icon-lg' })).toContain('[--lp-glow-size:0px]')
    expect(buttonVariants({})).toContain('disabled:[--lp-glow-strength:0%]')
    expect(buttonVariants({})).toContain('aria-pressed:[--lp-glow-size:0px]')
  })
})

describe('the link variant', () => {
  it('uses the strong primary: pastel text would not read on a light surface', () => {
    expect(buttonVariants({ variant: 'link' })).toContain('text-primary-strong')
    expect(buttonVariants({ variant: 'link' })).not.toMatch(/(^|\s)text-primary(\s|$)/)
  })
})

describe('the solid danger variant', () => {
  it('is white on the red danger colour, with no glow, for the buttons that cannot be undone', () => {
    const classes = buttonVariants({ variant: 'danger' })

    expect(classes).toContain('bg-danger')
    expect(classes).toContain('text-on-danger')
    expect(classes).not.toContain(glowClass)
  })

  it('is not the tinted destructive variant, which stays as it was', () => {
    expect(buttonVariants({ variant: 'destructive' })).toContain('bg-destructive/10')
    expect(buttonVariants({ variant: 'destructive' })).not.toContain('bg-danger')
  })

  it('renders as a button of its size', () => {
    render(<Button variant="danger" size="touch">Remove</Button>)

    expect(screen.getByRole('button', { name: 'Remove' })).toHaveClass('bg-danger', 'h-11')
  })
})

describe('ActionIcon', () => {
  it('sits at the start of the label, hidden from assistive technology, so the button keeps its name', () => {
    const { container } = render(
      <Button>
        <ActionIcon action="retry" />
        Try again
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    const icon = container.querySelector('svg')
    expect(icon).toHaveAttribute('data-icon', 'inline-start')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})
