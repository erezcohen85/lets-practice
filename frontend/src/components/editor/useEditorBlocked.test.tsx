import { act, render, screen } from '@testing-library/react'
import { stubPhoneWindow } from '@/test/phoneWindow'
import { useEditorBlocked } from './useEditorBlocked'

function Probe() {
  return <p>{useEditorBlocked() ? 'blocked' : 'editor'}</p>
}

afterEach(() => vi.unstubAllGlobals())

describe('useEditorBlocked', () => {
  it('blocks a phone: a phone-sized screen with touch only', () => {
    stubPhoneWindow(true)
    render(<Probe />)

    expect(screen.getByText('blocked')).toBeInTheDocument()
  })

  it('never blocks a computer: a window dragged to phone size that has a mouse or trackpad', () => {
    stubPhoneWindow(true, { mouse: true })
    render(<Probe />)

    expect(screen.getByText('editor')).toBeInTheDocument()
  })

  it('leaves a tablet or a computer alone: a screen past the phone rule', () => {
    stubPhoneWindow(false)
    render(<Probe />)

    expect(screen.getByText('editor')).toBeInTheDocument()
  })

  it('is false where the browser has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<Probe />)

    expect(screen.getByText('editor')).toBeInTheDocument()
  })

  it('follows the screen while it is open: a tablet Split View shrunk to phone size', () => {
    const window = stubPhoneWindow(false)
    render(<Probe />)

    act(() => window.resize(true))
    expect(screen.getByText('blocked')).toBeInTheDocument()

    act(() => window.resize(false))
    expect(screen.getByText('editor')).toBeInTheDocument()
  })
})
