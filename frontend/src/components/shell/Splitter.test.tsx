import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Splitter } from '@/components/shell/Splitter'

/** A splitter holding its own value, the way the page does. */
function Harness({ orientation, start = 360 }: { orientation: 'vertical' | 'horizontal'; start?: number }) {
  const [value, setValue] = useState(start)
  return <Splitter orientation={orientation} label="Resize" value={value} min={280} max={600} defaultValue={360} onChange={setValue} />
}

const separator = () => screen.getByRole('separator', { name: 'Resize' })
const now = () => Number(separator().getAttribute('aria-valuenow'))

describe('Splitter', () => {
  it('is a focusable separator with its orientation and range', () => {
    render(<Harness orientation="vertical" />)

    expect(separator()).toHaveAttribute('aria-orientation', 'vertical')
    expect(separator()).toHaveAttribute('aria-valuenow', '360')
    expect(separator()).toHaveAttribute('aria-valuemin', '280')
    expect(separator()).toHaveAttribute('aria-valuemax', '600')
    expect(separator()).toHaveAttribute('tabindex', '0')
  })

  it('drags a vertical line: moving left makes the pane after it wider, and stays inside the range', () => {
    render(<Harness orientation="vertical" />)

    fireEvent.pointerDown(separator(), { clientX: 1000, pointerId: 1 })
    fireEvent.pointerMove(separator(), { clientX: 940, pointerId: 1 })
    expect(now()).toBe(420)
    fireEvent.pointerMove(separator(), { clientX: 100, pointerId: 1 })
    expect(now()).toBe(600)
    fireEvent.pointerMove(separator(), { clientX: 1900, pointerId: 1 })
    expect(now()).toBe(280)
    fireEvent.pointerUp(separator(), { clientX: 1900, pointerId: 1 })
    fireEvent.pointerMove(separator(), { clientX: 900, pointerId: 1 })
    expect(now()).toBe(280)
  })

  it('drags a horizontal line: moving up makes the pane below it taller', () => {
    render(<Harness orientation="horizontal" />)

    fireEvent.pointerDown(separator(), { clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(separator(), { clientY: 450, pointerId: 1 })
    fireEvent.pointerUp(separator(), { clientY: 450, pointerId: 1 })

    expect(now()).toBe(410)
    expect(separator()).toHaveAttribute('aria-orientation', 'horizontal')
  })

  it('moves by 16 px with the arrow keys and by 64 px with Shift, clamped at the ends', async () => {
    const user = userEvent.setup()
    render(<Harness orientation="vertical" />)
    separator().focus()

    await user.keyboard('{ArrowLeft}')
    expect(now()).toBe(376)
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(now()).toBe(344)
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    expect(now()).toBe(408)
    await user.keyboard('{End}')
    expect(now()).toBe(600)
    await user.keyboard('{ArrowLeft}')
    expect(now()).toBe(600)
    await user.keyboard('{Home}')
    expect(now()).toBe(280)
    await user.keyboard('{ArrowRight}')
    expect(now()).toBe(280)
  })

  it('uses Up and Down for a horizontal line: Up grows the pane below', async () => {
    const user = userEvent.setup()
    render(<Harness orientation="horizontal" />)
    separator().focus()

    await user.keyboard('{ArrowUp}')
    expect(now()).toBe(376)
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(now()).toBe(344)
    await user.keyboard('{ArrowLeft}')
    expect(now()).toBe(344)
  })

  it('goes back to the default on a double click', async () => {
    const user = userEvent.setup()
    render(<Harness orientation="vertical" start={500} />)

    await user.dblClick(separator())

    expect(now()).toBe(360)
  })
})
