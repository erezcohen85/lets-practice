import { act, fireEvent, screen, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const CLARK = 'piece-clark-county'
const text = strings.editor

async function open() {
  const fakes = createFakes({ seed: 'demo' })
  const detail = (await fakes.data.getPiece(CLARK))!
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${detail.parts[0].id}`, { fakes })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  return view
}

function setWindow(width: number, height: number) {
  vi.stubGlobal('innerWidth', width)
  vi.stubGlobal('innerHeight', height)
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

const main = () => document.querySelector('main')!
const size = (name: string) => main().style.getPropertyValue(name)
const queueLine = () => screen.getByRole('separator', { name: text.resizeQueue })
const dockLine = () => screen.getByRole('separator', { name: text.resizeDock })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  setWindow(1440, 900)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('resizing the editor regions', () => {
  it('starts with the queue 360 px wide and the dock at its usual height, each between its own limits', async () => {
    await open()

    expect(size('--queue-width')).toBe('360px')
    expect(queueLine()).toHaveAttribute('aria-valuenow', '360')
    expect(queueLine()).toHaveAttribute('aria-valuemin', '280')
    expect(queueLine()).toHaveAttribute('aria-valuemax', '720')
    expect(dockLine()).toHaveAttribute('aria-valuemin', '236')
    expect(dockLine()).toHaveAttribute('aria-valuemax', '540')
    expect(size('--dock-height')).toBe(`${dockLine().getAttribute('aria-valuenow')}px`)
  })

  it('drags the line left of the queue: the queue takes the width and the score column keeps the rest', async () => {
    await open()

    fireEvent.pointerDown(queueLine(), { clientX: 1080, pointerId: 1 })
    fireEvent.pointerMove(queueLine(), { clientX: 980, pointerId: 1 })
    fireEvent.pointerUp(queueLine(), { clientX: 980, pointerId: 1 })

    expect(size('--queue-width')).toBe('460px')
    expect(screen.getByRole('complementary', { name: strings.review.queue.title }).className).toContain('--queue-width')
  })

  it('drags the line above the dock: the dock takes the height', async () => {
    await open()
    const before = Number(dockLine().getAttribute('aria-valuenow'))

    fireEvent.pointerDown(dockLine(), { clientY: 600, pointerId: 1 })
    fireEvent.pointerMove(dockLine(), { clientY: 560, pointerId: 1 })
    fireEvent.pointerUp(dockLine(), { clientY: 560, pointerId: 1 })

    expect(size('--dock-height')).toBe(`${before + 40}px`)
  })

  it('holds both sizes inside their limits and resets them on a double click', async () => {
    await open()
    const before = dockLine().getAttribute('aria-valuenow')

    fireEvent.pointerDown(queueLine(), { clientX: 1080, pointerId: 1 })
    fireEvent.pointerMove(queueLine(), { clientX: 0, pointerId: 1 })
    fireEvent.pointerUp(queueLine(), { clientX: 0, pointerId: 1 })
    expect(size('--queue-width')).toBe('720px')
    fireEvent.pointerDown(dockLine(), { clientY: 600, pointerId: 1 })
    fireEvent.pointerMove(dockLine(), { clientY: 5000, pointerId: 1 })
    fireEvent.pointerUp(dockLine(), { clientY: 5000, pointerId: 1 })
    expect(size('--dock-height')).toBe('236px')

    fireEvent.doubleClick(queueLine())
    fireEvent.doubleClick(dockLine())
    expect(size('--queue-width')).toBe('360px')
    expect(size('--dock-height')).toBe(`${before}px`)
  })

  it('keeps a size inside the limits when the window shrinks, and moves on the arrow keys', async () => {
    await open()
    fireEvent.keyDown(queueLine(), { key: 'End' })
    expect(size('--queue-width')).toBe('720px')

    setWindow(1100, 700)

    expect(queueLine()).toHaveAttribute('aria-valuemax', '550')
    expect(size('--queue-width')).toBe('550px')
    fireEvent.keyDown(queueLine(), { key: 'ArrowRight' })
    expect(size('--queue-width')).toBe('534px')
  })

  it('keeps no size in browser storage', async () => {
    await open()
    fireEvent.keyDown(queueLine(), { key: 'ArrowLeft' })

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})

describe('the edit hint', () => {
  const statusRow = () => document.querySelector<HTMLElement>('[data-slot="page-label"]')!.parentElement!
  const sheet = () => screen.getByRole('region', { name: text.sheet })

  it('sits in the status row between the page line and the status, not in the Edit sheet', async () => {
    const { user } = await open()

    // Move has no hint, so the line is there but empty; it fills when the Add mode names what a click does.
    const hint = document.querySelector<HTMLElement>('[data-slot="edit-hint"]')!
    expect(hint).toBeEmptyDOMElement()
    expect(hint).toHaveClass('truncate')
    expect(statusRow().children[0]).toHaveAttribute('data-slot', 'page-label')
    expect(statusRow().children[1]).toBe(hint)
    expect(statusRow().children[2].querySelector('[data-slot="editor-status"]')).not.toBeNull()

    await user.click(within(sheet()).getByRole('button', { name: text.modes.add }))

    expect(within(statusRow()).getByText(text.hints.add)).toHaveAttribute('title', text.hints.add)
    expect(sheet().querySelector('[role="status"]')).toBeNull()
  })
})
