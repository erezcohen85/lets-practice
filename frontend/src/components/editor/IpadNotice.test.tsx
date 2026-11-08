import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { strings } from '@/strings'
import { IpadNotice } from './IpadNotice'

const text = strings.editor.ipad

/** A window of `width` px whose pointers are `coarse` (touch only) or fine. */
function stubWindow({ width, coarse }: { width: number; coarse: boolean }) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const matches = max !== null ? width <= Number(max[1]) : query.includes('any-pointer: fine') ? !coarse : query.includes('pointer: coarse') ? coarse : false
    return { matches, media: query, addEventListener() {}, removeEventListener() {} }
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('IpadNotice', () => {
  it('shows below 1024 px', () => {
    stubWindow({ width: 820, coarse: false })
    render(<IpadNotice />)

    expect(screen.getByText(text.notice)).toBeInTheDocument()
  })

  it('shows on a touch-only device of any width', () => {
    stubWindow({ width: 1366, coarse: true })
    render(<IpadNotice />)

    expect(screen.getByText(text.notice)).toBeInTheDocument()
  })

  it('does not show on a wide window with a fine pointer', () => {
    stubWindow({ width: 1440, coarse: false })
    render(<IpadNotice />)

    expect(screen.queryByText(text.notice)).toBeNull()
  })

  it('does not show where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<IpadNotice />)

    expect(screen.queryByText(text.notice)).toBeNull()
  })

  it('is dismissed with its button, for this visit only (nothing is stored)', async () => {
    stubWindow({ width: 820, coarse: false })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { unmount } = render(<IpadNotice />)

    await userEvent.click(screen.getByRole('button', { name: text.dismiss }))

    expect(screen.queryByText(text.notice)).toBeNull()
    expect(setItem).not.toHaveBeenCalled()
    unmount()
    render(<IpadNotice />)
    expect(screen.getByText(text.notice)).toBeInTheDocument()
  })
})
