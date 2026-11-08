import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ViewSwitch } from '@/components/shell/ViewSwitch'
import { strings } from '@/strings'

const text = strings.common

function setup(props: Partial<Parameters<typeof ViewSwitch>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ViewSwitch active="practice" practiceHref="/pieces/p1/practice?part=a" editHref="/pieces/p1/edit?part=a&bar=3" {...props} />
    </MemoryRouter>,
  )
}

describe('ViewSwitch', () => {
  it('is a group named "Practice or Edit" with a link for each side, to the given places', () => {
    setup()

    const group = screen.getByRole('group', { name: text.viewSwitch })
    expect(group).toContainElement(screen.getByRole('link', { name: text.viewPractice }))
    expect(group).toContainElement(screen.getByRole('link', { name: text.viewEdit }))
    expect(screen.getByRole('link', { name: text.viewPractice })).toHaveAttribute('href', '/pieces/p1/practice?part=a')
    expect(screen.getByRole('link', { name: text.viewEdit })).toHaveAttribute('href', '/pieces/p1/edit?part=a&bar=3')
  })

  it('marks the Practice side as the current page, teal, with a filled play icon and a glow, and the Edit side grey with the pencil and ruler', () => {
    setup({ active: 'practice' })

    const practice = screen.getByRole('link', { name: text.viewPractice })
    const edit = screen.getByRole('link', { name: text.viewEdit })
    expect(practice).toHaveAttribute('aria-current', 'page')
    expect(edit).not.toHaveAttribute('aria-current')
    expect(practice).toHaveClass('bg-primary', 'text-on-primary', 'font-semibold')
    expect(practice.className).toContain('--lp-glow-size:24px')
    expect(practice.querySelector('svg')).toHaveClass('lucide-play', 'fill-current')
    expect(edit).toHaveClass('text-text-soft', 'font-medium')
    expect(edit).not.toHaveClass('bg-edit')
    expect(edit.className).not.toContain('--lp-glow-size')
    expect(edit.querySelector('svg')).toHaveClass('lucide-pencil-ruler')
  })

  it('marks the Edit side as the current page, in the edit colour, with a dark label and a glow in its colour, and the Practice side grey', () => {
    setup({ active: 'edit' })

    const practice = screen.getByRole('link', { name: text.viewPractice })
    const edit = screen.getByRole('link', { name: text.viewEdit })
    expect(edit).toHaveAttribute('aria-current', 'page')
    expect(practice).not.toHaveAttribute('aria-current')
    expect(edit).toHaveClass('bg-edit', 'text-on-edit', 'font-semibold')
    expect(edit).not.toHaveClass('text-background')
    expect(edit.className).toContain('--lp-glow-colour:var(--lp-edit)')
    expect(practice).toHaveClass('text-text-soft', 'font-medium')
    expect(practice).not.toHaveClass('bg-primary')
    expect(practice.querySelector('svg')).toHaveClass('lucide-play')
    expect(practice.querySelector('svg')).toHaveClass('fill-current')
  })

  it('keeps each side 40 px high with the icon and the text apart', () => {
    setup()

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveClass('h-10', 'gap-2', 'rounded-lg')
      expect(link.querySelector('svg')).toHaveClass('size-4')
    }
  })

  it('shows nothing at all without an Edit place (a member has no editing)', () => {
    setup({ editHref: null })

    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
