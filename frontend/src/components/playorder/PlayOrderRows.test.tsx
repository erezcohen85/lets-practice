import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { strings } from '@/strings'
import { PlayOrderRows, type PlayOrderDraftRow } from './PlayOrderRows'

const text = strings.structure.playOrder

function Harness({ initial, onChange }: { initial: PlayOrderDraftRow[]; onChange?: (rows: PlayOrderDraftRow[]) => void }) {
  const [rows, setRows] = useState(initial)
  return (
    <PlayOrderRows
      rows={rows}
      barCount={64}
      errors={[]}
      onChange={(next) => {
        setRows(next)
        onChange?.(next)
      }}
    />
  )
}

const row = (from: number, to: number) => ({ from: String(from), to: String(to) })

describe('PlayOrderRows', () => {
  it('counts the bars played and names the repeats', () => {
    render(<Harness initial={[row(1, 16), row(9, 16), row(17, 64)]} />)
    expect(screen.getByText('72 bars played; bars 9-16 twice')).toBeInTheDocument()
  })

  it('says only the count when nothing repeats, and "bar" for one repeated bar', () => {
    const { unmount } = render(<Harness initial={[row(1, 64)]} />)
    expect(screen.getByText('64 bars played')).toBeInTheDocument()
    unmount()

    render(<Harness initial={[row(1, 3), row(2, 2)]} />)
    expect(screen.getByText('4 bars played; bar 2 twice')).toBeInTheDocument()
  })

  it('gives no count while a row is not filled in', () => {
    render(<Harness initial={[row(1, 16), { from: '', to: '' }]} />)
    expect(screen.queryByText(/bars played/)).not.toBeInTheDocument()
  })

  it('hands the next rows to onChange when one is moved, added or removed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={[row(1, 8), row(9, 16)]} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: text.moveDown(1) }))
    expect(onChange).toHaveBeenLastCalledWith([row(9, 16), row(1, 8)])

    await user.click(screen.getByRole('button', { name: text.add }))
    expect(onChange).toHaveBeenLastCalledWith([row(9, 16), row(1, 8), { from: '', to: '' }])

    await user.click(screen.getByRole('button', { name: text.remove(1) }))
    expect(onChange).toHaveBeenLastCalledWith([row(1, 8), { from: '', to: '' }])
  })
})
