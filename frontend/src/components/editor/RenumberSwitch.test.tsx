import { render, screen } from '@testing-library/react'
import { RenumberSwitch } from '@/components/editor/RenumberSwitch'
import { strings } from '@/strings'

describe('RenumberSwitch in the waveform dock', () => {
  it('shows the full label from 1700 px and the short one below it, and is named by the full one at every width', () => {
    render(<RenumberSwitch mode="ripple" onChange={() => {}} dock />)

    const full = screen.getByText(strings.editor.renumber, { selector: 'span[aria-hidden]' })
    const short = screen.getByText(strings.editor.renumberShort, { selector: 'span[aria-hidden]' })
    expect(full.className).toContain('max-[1699px]:hidden')
    expect(short.className).toContain('hidden')
    expect(short.className).toContain('max-[1699px]:inline')
    expect(screen.getByRole('switch', { name: strings.editor.renumber })).toBeInTheDocument()
  })

  it('keeps its one label when it is not in the dock', () => {
    render(<RenumberSwitch mode="plain" onChange={() => {}} />)

    expect(screen.queryByText(strings.editor.renumberShort)).toBeNull()
    expect(screen.getByText(strings.editor.renumber, { selector: 'span[aria-hidden]' }).className).not.toContain('max-[1699px]')
  })
})
