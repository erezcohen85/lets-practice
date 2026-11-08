import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewCard, type ReviewAction } from '@/components/review/ReviewCard'
import { type ReviewItem } from '@/domain/reviewQueue'
import { strings } from '@/strings'

const text = strings.editor.status
const unmatched = { kind: 'unmatched', bar: 10, passIndex: 0 } as const

function card(realigning: boolean) {
  render(
    <ul>
      <ReviewCard item={unmatched} partName="Clarinet" movedBySec={null} open realigning={realigning} onToggle={() => {}} onAction={() => {}} />
    </ul>,
  )
}

describe('the Realign action of an open card', () => {
  it('explains Realign on hover', () => {
    card(false)
    expect(screen.getByRole('button', { name: text.realign })).toHaveAttribute('title', text.realignTip)
  })

  it('keeps the tip on the disabled button while it realigns', () => {
    card(true)
    const button = screen.getByRole('button', { name: text.realigning })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', text.realignTip)
    expect(button).toHaveClass('disabled:pointer-events-auto')
  })
})

describe('the Wrong beat card', () => {
  const pulse = { kind: 'pulse', severity: 1, expected: 2.9375, found: 1.03, factor: 0.35, explainedBy: null, uncertainLine: null } as const
  const item = (rest: Partial<Extract<ReviewItem, { kind: 'flag' }>> = {}): ReviewItem => ({ kind: 'flag', bar: 1, passIndex: 0, timeSec: 1, flags: [pulse], checked: false, moved: false, ...rest })
  const show = (props: Partial<React.ComponentProps<typeof ReviewCard>> = {}, onAction: (action: ReviewAction) => void = () => {}) =>
    render(
      <ul>
        <ReviewCard item={item()} partName="Clarinet" movedBySec={null} open realigning={false} onToggle={() => {}} onAction={onAction} {...props} />
      </ul>,
    )

  it('is titled Wrong beat, says what it heard, and offers the button first and Sounds right after it', () => {
    show()
    expect(screen.getByRole('button', { name: new RegExp(`^Bar 1 ${strings.review.chips.pulse}`) })).toBeInTheDocument()
    expect(screen.getByText(/^The recording's beat looks like 1 per bar, not 3\. /)).toBeInTheDocument()
    const buttons = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-expanded') === null)
    expect(buttons.map((button) => button.textContent)).toEqual([strings.review.queue.putOnBeats, strings.review.queue.soundsRight])
  })

  it('sends regrid-pulse when the button is pressed', async () => {
    const actions: ReviewAction[] = []
    show({}, (action) => actions.push(action))
    await userEvent.setup().click(screen.getByRole('button', { name: strings.review.queue.putOnBeats }))
    expect(actions).toEqual(['regrid-pulse'])
  })

  it('has no button once the card is checked', () => {
    show({ item: item({ checked: true }) })
    expect(screen.queryByRole('button', { name: strings.review.queue.putOnBeats })).not.toBeInTheDocument()
  })

  it('has no button where the page cannot put the lines on the beats', () => {
    show({ canPulse: false })
    expect(screen.queryByRole('button', { name: strings.review.queue.putOnBeats })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.review.queue.soundsRight })).toBeInTheDocument()
  })

  it('says why the last try did not change anything, and stays open with its buttons', () => {
    show({ notice: strings.dock.grid.refusedNothing })
    expect(screen.getByRole('status')).toHaveTextContent(strings.dock.grid.refusedNothing)
    expect(screen.getByRole('button', { name: strings.review.queue.putOnBeats })).toBeInTheDocument()
  })

  it('offers the button on a pulse card of any bar: the flag follows its line when bars are added before it', () => {
    show({ item: item({ bar: 5, passIndex: 0, timeSec: 9 }) })
    expect(screen.getByRole('button', { name: strings.review.queue.putOnBeats })).toBeInTheDocument()
  })

  it('puts the button before Resolved on a pulse card the user also moved by hand', () => {
    show({ item: item({ moved: true }) })
    const buttons = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-expanded') === null)
    expect(buttons.map((button) => button.textContent)).toEqual([strings.review.queue.putOnBeats, strings.review.queue.resolved, strings.review.queue.undoMove])
  })

  it('leaves another flag with its one button', () => {
    show({ item: item({ flags: [{ ...pulse, kind: 'crowded' }] }) })
    expect(screen.queryByRole('button', { name: strings.review.queue.putOnBeats })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.review.queue.soundsRight })).toBeInTheDocument()
  })
})
