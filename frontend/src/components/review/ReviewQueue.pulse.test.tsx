import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ReviewQueue } from '@/components/review/ReviewQueue'
import { type EditorDoc } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { type ReviewFlag } from '@/domain/types'
import { strings } from '@/strings'

// The Wrong beat card in the queue: its button asks the page to put the bar lines on the beats; the page answers with the reason
// when nothing changed, and the card shows it and stays.

const text = strings.review.queue

const pulse: ReviewFlag = { kind: 'pulse', severity: 1, expected: 2.9375, found: 1.03, factor: 0.35, explainedBy: null, uncertainLine: null }

/** The demo doc with the pulse flag on its first locator (bar 1). */
function pulseDoc(): EditorDoc {
  const doc = demoDoc()
  return { ...doc, timing: { ...doc.timing, locators: doc.timing.locators.map((locator, index) => (index === 0 ? { ...locator, flags: [pulse] } : locator)) } }
}

function Harness({ answer, calls, withHandler = true }: { answer: () => string | null; calls: string[]; withHandler?: boolean }) {
  const [doc, setDoc] = useState(pulseDoc())
  return (
    <>
      {/* any edit of the timing: the page's notice about the last press goes away with it */}
      <button onClick={() => setDoc({ ...doc, timing: { ...doc.timing } })}>edit</button>
      <ReviewQueue
        doc={doc}
        partId="clarinet"
        partName="Clarinet"
        selected={null}
        onApply={() => null}
        onFocusItem={() => {}}
        realigning={false}
        onRealign={() => {}}
        onOpenStructure={() => {}}
        onPulseRegrid={
          withHandler
            ? () => {
                calls.push('pulse')
                return answer()
              }
            : undefined
        }
      />
    </>
  )
}

const card = () => screen.getByRole('button', { name: /^Bar 1\b/ })
const cardItem = () => card().closest('li')!

describe('the Wrong beat card in the Review Queue', () => {
  it('lists the first bar with the chip Wrong beat, and opened, the sentence and the button', async () => {
    const user = userEvent.setup()
    render(<Harness answer={() => null} calls={[]} />)

    expect(card()).toHaveTextContent('Bar 1 Wrong beat')
    await user.click(card())

    expect(within(cardItem()).getByText(/^The recording's beat looks like 1 per bar, not 3\./)).toBeInTheDocument()
    expect(within(cardItem()).getByRole('button', { name: text.putOnBeats })).toBeInTheDocument()
  })

  it('asks the page to put the lines on the beats when the button is pressed', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    render(<Harness answer={() => null} calls={calls} />)
    await user.click(card())

    await user.click(within(cardItem()).getByRole('button', { name: text.putOnBeats }))

    expect(calls).toEqual(['pulse'])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the reason on the card and stays open when the page says nothing changed; any edit takes the reason away', async () => {
    const user = userEvent.setup()
    render(<Harness answer={() => strings.dock.grid.refusedNothing} calls={[]} />)
    await user.click(card())

    await user.click(within(cardItem()).getByRole('button', { name: text.putOnBeats }))

    expect(within(cardItem()).getByRole('status')).toHaveTextContent(strings.dock.grid.refusedNothing)
    expect(card()).toHaveAttribute('aria-expanded', 'true')
    expect(within(cardItem()).getByRole('button', { name: text.putOnBeats })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'edit' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers no button when the page cannot do it, but keeps Sounds right', async () => {
    const user = userEvent.setup()
    render(<Harness answer={() => null} calls={[]} withHandler={false} />)
    await user.click(card())

    expect(within(cardItem()).queryByRole('button', { name: text.putOnBeats })).not.toBeInTheDocument()
    expect(within(cardItem()).getByRole('button', { name: text.soundsRight })).toBeInTheDocument()
  })
})
