import { render, screen } from '@testing-library/react'
import { TransportRow } from '@/components/waveform/Transport'
import { barNamesOf } from '@/domain/barNames'
import { BarNamesProvider } from '@/lib/BarNamesProvider'
import { type Transport } from '@/lib/useTransport'
import { strings } from '@/strings'

const transport: Transport = { ready: true, playing: false, timeSec: 0, durationSec: 60, error: false, toggle: vi.fn(), seek: vi.fn() }

// The chip beside the time says which time through a repeated bar the selected locator (or the playhead) is on.
describe('the bar chip', () => {
  it('reads the bar alone on the first time through, and "Bar 12 (2)" from the second', () => {
    const { rerender } = render(<TransportRow transport={transport} unavailable={false} bar={12} passIndex={0} />)
    expect(screen.getByLabelText(strings.dock.barChipLabel)).toHaveTextContent(/^Bar 12$/)

    rerender(<TransportRow transport={transport} unavailable={false} bar={12} passIndex={1} />)
    expect(screen.getByLabelText(strings.dock.barChipLabel)).toHaveTextContent(/^Bar 12 \(2\)$/)
  })

  it('reads "Bar p7 (2)" on a pickup, by its label', () => {
    // Bar 7 is an unnumbered pickup in the middle of the piece: it reads p7.
    render(
      <BarNamesProvider names={barNamesOf([{ bar: 7, units: 1, unnumbered: true }])}>
        <TransportRow transport={transport} unavailable={false} bar={7} passIndex={1} />
      </BarNamesProvider>,
    )
    expect(screen.getByLabelText(strings.dock.barChipLabel)).toHaveTextContent(/^Bar p7 \(2\)$/)
  })
})
