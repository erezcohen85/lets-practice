import { render, screen } from '@testing-library/react'
import { ReviewProgress } from '@/components/review/ReviewProgress'

const checkedPart = () => document.querySelector<HTMLElement>('[data-slot="review-progress-checked"]')!
const movedPart = () => document.querySelector<HTMLElement>('[data-slot="review-progress-moved"]')

describe('ReviewProgress', () => {
  it('is a progress bar of the checked items, filled to checked / total', () => {
    render(<ReviewProgress checked={7} moved={0} total={12} />)

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '7')
    expect(bar).toHaveAttribute('aria-valuemax', '12')
    expect(checkedPart().style.inlineSize).toBe(`${(7 / 12) * 100}%`)
    expect(movedPart()).toBeNull()
  })

  it('draws the moved, unchecked items hatched after the checked part', () => {
    render(<ReviewProgress checked={7} moved={2} total={12} />)

    expect(movedPart()).not.toBeNull()
    expect(movedPart()!.style.inlineSize).toBe(`${(2 / 12) * 100}%`)
    expect(checkedPart().nextElementSibling).toBe(movedPart())
  })

  it('is empty when there is nothing to check', () => {
    render(<ReviewProgress checked={0} moved={0} total={0} />)

    expect(checkedPart().style.inlineSize).toBe('0%')
  })
})
