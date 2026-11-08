import { fireEvent, render, screen } from '@testing-library/react'
import { strings } from '@/strings'
import { TokenShowcase } from './TokenShowcase'
import { tokens } from './tokens'

afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe('TokenShowcase', () => {
  it('shows the title as the main heading', () => {
    render(<TokenShowcase />)
    expect(screen.getByRole('heading', { level: 1, name: strings.showcase.title })).toBeInTheDocument()
  })

  it('renders one swatch per colour role of the dark theme', () => {
    render(<TokenShowcase />)
    expect(screen.getAllByTestId('swatch')).toHaveLength(Object.keys(tokens.color.dark).length)
  })

  it('every swatch paints with a token variable, never a literal colour', () => {
    render(<TokenShowcase />)
    for (const swatch of screen.getAllByTestId('swatch')) {
      expect(swatch.getAttribute('style')).toMatch(/var\(--lp-[\w-]+\)/)
    }
  })

  it('names each colour role by its key and its CSS variable', () => {
    render(<TokenShowcase />)
    expect(screen.getByText('surface2')).toBeInTheDocument()
    expect(screen.getByText('--lp-surface-2')).toBeInTheDocument()
    expect(screen.getByText('--lp-paper-cursor')).toBeInTheDocument()
  })

  it('builds the aurora strip from the four aurora variables', () => {
    render(<TokenShowcase />)
    const style = screen.getByTestId('aurora').getAttribute('style') ?? ''
    for (let i = 1; i <= tokens.aurora.length; i++) {
      expect(style).toContain(`var(--lp-aurora-${i})`)
    }
  })

  it('has no part colour section', () => {
    render(<TokenShowcase />)
    expect(screen.queryAllByTestId('part')).toHaveLength(0)
    expect(screen.queryByText(/part colou?rs?/i)).not.toBeInTheDocument()
  })

  it('theme toggle switches data-theme to light and back to dark', () => {
    render(<TokenShowcase />)
    expect(document.documentElement.dataset.theme).not.toBe('light')

    fireEvent.click(screen.getByRole('button', { name: strings.showcase.toLight }))
    expect(document.documentElement.dataset.theme).toBe('light')

    fireEvent.click(screen.getByRole('button', { name: strings.showcase.toDark }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('starts on the theme the page already has', () => {
    document.documentElement.dataset.theme = 'light'
    render(<TokenShowcase />)
    expect(screen.getByRole('button', { name: strings.showcase.toDark })).toBeInTheDocument()
  })
})
