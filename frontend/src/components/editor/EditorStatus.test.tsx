import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { strings } from '@/strings'
import { EditorStatus, type EditorStatusProps } from './EditorStatus'

const text = strings.editor

const quiet = { onRetry() {}, onOpenStructure() {}, onRealign() {} }

/** The status line; with nothing to report it is empty. */
function Status(props: Partial<EditorStatusProps>) {
  return (
    <EditorStatus
      saveState="saved"
      settingsFailed={false}
      partProblem={null}
      unmatchedCount={0}
      movedCount={0}
      structureChanged={false}
      realigning={false}
      realignError={null}
      {...quiet}
      {...props}
    />
  )
}

function setup(props: Partial<EditorStatusProps> = {}) {
  const handlers = { onRetry: vi.fn(), onOpenStructure: vi.fn(), onRealign: vi.fn() }
  render(<Status {...handlers} {...props} />)
  return handlers
}

describe('EditorStatus', () => {
  it('is empty when there is nothing to report (no "Drag a bar line" hint in Move mode: Erez removed it)', () => {
    render(<Status />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('shows Not saved with Retry, which calls onRetry', async () => {
    const { onRetry } = setup({ saveState: 'failed' })

    expect(screen.getByText(text.notSaved)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: text.retrySave }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('names the part and both bar counts, with Open Structure', async () => {
    const { onOpenStructure } = setup({ partProblem: { name: 'Trumpet in B♭ 2', partBars: 63, pieceBars: 64 } })

    expect(screen.getByText('Trumpet in B♭ 2 has 63 bars; the piece has 64.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: text.status.openStructure }))

    expect(onOpenStructure).toHaveBeenCalledTimes(1)
  })

  it('counts the bars without a time ("1 bar has", "2 bars have") with Realign', async () => {
    const { onRealign } = setup({ unmatchedCount: 1 })
    expect(screen.getByText('1 bar has no time in the recording yet.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: text.status.realign }))
    expect(onRealign).toHaveBeenCalledTimes(1)
  })

  it('says the empty bars are being filled, and how many were filled in', () => {
    const { unmount } = render(<Status filling />)
    expect(screen.getByText(text.status.filling)).toBeInTheDocument()
    unmount()

    render(<Status filledCount={1} />)
    expect(screen.getByText(text.status.filled(1))).toBeInTheDocument()
  })

  it('says "2 bars have no time"', () => {
    setup({ unmatchedCount: 2 })

    expect(screen.getByText('2 bars have no time in the recording yet.')).toBeInTheDocument()
  })

  it('offers Realign after a structure change even when every bar has a time', () => {
    setup({ structureChanged: true })

    expect(screen.getByText(text.status.structureChanged)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.status.realign })).toBeEnabled()
  })

  it('has no Realign when nothing asks for it', () => {
    setup()

    expect(screen.queryByRole('button', { name: text.status.realign })).toBeNull()
  })

  it('shows Realigning… on a disabled button while the job runs', () => {
    setup({ unmatchedCount: 1, realigning: true })

    expect(screen.getByRole('button', { name: text.status.realigning })).toBeDisabled()
  })

  it('explains Realign on hover, also on the disabled button while it runs', () => {
    const { unmount } = render(<Status unmatchedCount={1} />)
    expect(screen.getByRole('button', { name: text.status.realign })).toHaveAttribute('title', text.status.realignTip)
    unmount()
    setup({ unmatchedCount: 1, realigning: true })
    const running = screen.getByRole('button', { name: text.status.realigning })
    expect(running).toBeDisabled()
    expect(running).toHaveAttribute('title', text.status.realignTip)
    // The base button turns pointer events off when disabled, which would hide the tip.
    expect(running).toHaveClass('disabled:pointer-events-auto')
  })

  it('shows the error of a failed realign, and the settings save failure', () => {
    setup({ unmatchedCount: 1, realignError: 'align failed', settingsFailed: true })

    expect(screen.getByText('align failed')).toBeInTheDocument()
    expect(screen.getByText(strings.settings.saveFailed)).toBeInTheDocument()
  })

  it('lists the most important first: not saved, then the realign error, the bar count, the bars without a time', () => {
    setup({
      saveState: 'failed',
      realignError: 'align failed',
      partProblem: { name: 'Flute 1', partBars: 63, pieceBars: 64 },
      unmatchedCount: 1,
    })

    const content = screen.getByRole('status').textContent ?? ''
    const positions = ['Not saved', 'align failed', 'Flute 1 has', '1 bar has'].map((part) => content.indexOf(part))
    expect(positions.every((at) => at >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('says how many bar lines were moved by hand', () => {
    const { unmount } = render(<Status movedCount={2} />)
    expect(screen.getByRole('status')).toHaveTextContent('2 bar lines moved by hand. Not resolved yet.')
    unmount()

    render(<Status movedCount={1} />)
    expect(screen.getByRole('status')).toHaveTextContent('1 bar line moved by hand. Not resolved yet.')
  })

  it('says what a ripple edit moved', () => {
    render(<Status shiftNote="Bars 31 to 56 moved one bar back." />)

    expect(screen.getByRole('status')).toHaveTextContent('Bars 31 to 56 moved one bar back.')
  })

  it('leaves out the "bars were filled in" line while the shift sentence, which says it, is shown', () => {
    render(<Status filledCount={1} shiftNote="Bars 31 to 56 moved one bar back; bar 56 filled from the recording." />)

    expect(screen.queryByText(text.status.filled(1))).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('bar 56 filled from the recording.')
  })
})

describe('the bar-count guide (Decisions 2026-11-03)', () => {
  const advice = (kind: 'part-misread' | 'piece-may-be-wrong' | 'single-part', agreeWithPart = 0) => ({
    partBars: 103,
    pieceBars: 106,
    diff: -3,
    agreeWithPiece: 11,
    agreeWithPart,
    others: 13,
    kind,
  })

  it('calls a part misread and offers only its own fix, never a piece edit', async () => {
    const onEditPiece = vi.fn()
    const handlers = setup({ partProblem: { name: 'Tubas', partBars: 103, pieceBars: 106, advice: advice('part-misread') }, onEditPiece })

    expect(screen.getByRole('status')).toHaveTextContent(text.status.guideMisread('Tubas', -3))
    expect(screen.queryByRole('button', { name: text.status.editPiece })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: text.status.openStructure }))
    expect(handlers.onOpenStructure).toHaveBeenCalled()
  })

  it('offers Edit piece structure only when most other parts have this part\'s count', async () => {
    const onEditPiece = vi.fn()
    setup({ partProblem: { name: 'Tubas', partBars: 103, pieceBars: 106, advice: advice('piece-may-be-wrong', 12) }, onEditPiece })

    expect(screen.getByRole('status')).toHaveTextContent(text.status.guidePiece(12, 13))
    await userEvent.click(screen.getByRole('button', { name: text.status.editPiece }))
    expect(onEditPiece).toHaveBeenCalled()
  })

  it('says which bars have no time but offers no Realign when canRealign is off', () => {
    render(<Status unmatchedCount={2} canRealign={false} />)

    expect(screen.getByText(text.status.unmatched(2))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: text.status.realign })).toBeNull()
  })
})
