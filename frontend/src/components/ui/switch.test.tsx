import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch } from '@/components/ui/switch'

describe('Switch', () => {
  it('is teal when on by default', () => {
    render(<Switch aria-label="Bar numbers" defaultChecked />)

    expect(screen.getByRole('switch', { name: 'Bar numbers' })).toHaveClass('data-checked:bg-primary-strong')
    expect(screen.getByRole('switch', { name: 'Bar numbers' })).not.toHaveClass('data-checked:bg-danger-bright')
  })

  it('is the bright red when on with the danger tone, with a white knob, and still works as a switch', async () => {
    const user = userEvent.setup()
    render(<Switch tone="danger" aria-label="Edit piece structure" />)
    const toggle = screen.getByRole('switch', { name: 'Edit piece structure' })

    expect(toggle).toHaveClass('data-checked:bg-danger-bright')
    expect(toggle).not.toHaveClass('data-checked:bg-primary-strong')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle.querySelector('[data-slot="switch-thumb"]')).toHaveClass('data-checked:bg-on-danger')
  })
})
