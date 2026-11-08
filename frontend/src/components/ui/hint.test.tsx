import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'
import { Hint, hintOf } from '@/components/ui/hint'

describe('Hint, the hover text of a toolbar control', () => {
  it('shows its text on hover, after a short wait', async () => {
    render(
      <Hint text="Snap to closest beat (/)">
        <Button aria-label="Snap to closest beat">x</Button>
      </Hint>,
    )
    expect(screen.queryByText('Snap to closest beat (/)')).toBeNull()

    await userEvent.setup().hover(screen.getByRole('button'))

    expect(await screen.findByText('Snap to closest beat (/)')).toBeInTheDocument()
  })

  it('shows on a disabled control too, so it can say why the control is off', async () => {
    render(
      <Hint text="Select a bar line first.">
        <Button aria-label="Snap to next beat" disabled>
          x
        </Button>
      </Hint>,
    )

    await userEvent.setup().hover(screen.getByRole('button').parentElement!)

    expect(await screen.findByText('Select a bar line first.')).toBeInTheDocument()
  })

  it('shows when the control gets keyboard focus, and adds no stop to the Tab order', async () => {
    render(
      <Hint text="Zoom in on the waveform">
        <Button aria-label="Zoom in">+</Button>
      </Hint>,
    )
    const user = userEvent.setup()

    await user.tab()

    expect(screen.getByRole('button')).toHaveFocus()
    expect(await screen.findByText('Zoom in on the waveform')).toBeInTheDocument()
    expect(screen.getByRole('button').parentElement).not.toHaveAttribute('tabindex')
  })

  it('can be read off the control without hovering, for tests and checks', () => {
    render(
      <Hint text="Undo: move bar line after bar 3">
        <Button aria-label="Undo">u</Button>
      </Hint>,
    )
    expect(hintOf(screen.getByRole('button'))).toBe('Undo: move bar line after bar 3')
  })
})
