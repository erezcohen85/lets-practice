import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ZoomControls } from '@/components/score/ZoomControls'
import { strings } from '@/strings'

describe('ZoomControls', () => {
  it('shows the percent and calls back from the two icon buttons', async () => {
    const user = userEvent.setup()
    const onZoomIn = vi.fn()
    const onZoomOut = vi.fn()
    render(<ZoomControls percent={100} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />)

    expect(screen.getByText('100%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: strings.score.zoomIn }))
    await user.click(screen.getByRole('button', { name: strings.score.zoomOut }))

    expect(onZoomIn).toHaveBeenCalledOnce()
    expect(onZoomOut).toHaveBeenCalledOnce()
  })

  it('hides the "Zoom score" label visually below the lg breakpoint but keeps it for screen readers', () => {
    render(<ZoomControls percent={100} onZoomIn={() => {}} onZoomOut={() => {}} />)

    expect(screen.getByText(strings.score.zoomLabel)).toHaveClass('@max-[1018px]:sr-only')
  })
})
