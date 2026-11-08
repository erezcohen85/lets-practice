import { fireEvent, render, renderHook } from '@testing-library/react'
import { type FollowTarget } from '@/domain/practice'
import { LINE_AT, useFollowScroll } from './useFollowScroll'

const target = (pageIndex: number, lineTop: number): FollowTarget => ({
  box: { bar: 1, pageIndex, x: 0, y: lineTop, w: 100, h: 50 },
  lineTop,
  pageIndex,
  fraction: 0,
})

type Input = Parameters<typeof useFollowScroll>[0]

function setup(initial: Partial<Input> = {}) {
  const view = render(
    <div data-testid="practice">
      <div data-slot="score-scroll" data-testid="scroll" />
    </div>,
  )
  const containerRef = { current: view.getByTestId('practice') }
  let props = { scroll: 'line', target: target(0, 100), barIndex: 0, playing: false, containerRef, ...initial } as Input
  const hook = renderHook((input: Input) => useFollowScroll(input), { initialProps: props })
  const update = (change: Partial<Input>) => {
    props = { ...props, ...change }
    hook.rerender(props)
  }
  return { ...hook, update, scrollEl: view.getByTestId('scroll'), request: () => hook.result.current }
}

describe('useFollowScroll', () => {
  it('asks for the playing line to sit in the top of the column when scrolling by line', () => {
    const { request } = setup()

    expect(request()).toEqual({ pageIndex: 0, y: 100, at: LINE_AT })
    expect(LINE_AT).toBeGreaterThan(0)
    expect(LINE_AT).toBeLessThanOrEqual(1 / 3)
  })

  it('asks again only when the line changes, not at every bar of it', () => {
    const { request, update } = setup()
    const first = request()

    update({ target: target(0, 100), barIndex: 1 })
    expect(request()).toBe(first)

    update({ target: target(0, 260), barIndex: 5 })
    expect(request()).toEqual({ pageIndex: 0, y: 260, at: LINE_AT })
    expect(request()).not.toBe(first)
  })

  it('asks for the page, from its top, only when the cursor enters another page', () => {
    const { request, update } = setup({ scroll: 'page', target: target(0, 100) })
    expect(request()).toEqual({ pageIndex: 0, y: 0, at: 0 })
    const first = request()

    update({ target: target(0, 700), barIndex: 4 })
    expect(request()).toBe(first)

    update({ target: target(1, 80), barIndex: 8 })
    expect(request()).toEqual({ pageIndex: 1, y: 0, at: 0 })
  })

  it('goes back to the first page when a repeat does', () => {
    const { request, update } = setup({ scroll: 'page', target: target(1, 80), barIndex: 30 })

    update({ target: target(0, 80), barIndex: 16 })

    expect(request()).toEqual({ pageIndex: 0, y: 0, at: 0 })
  })

  it('asks for nothing while the cursor is outside the map', () => {
    const { request, update } = setup({ target: null })
    expect(request()).toBeNull()

    update({ target: target(0, 100), barIndex: 0 })
    expect(request()).toEqual({ pageIndex: 0, y: 100, at: LINE_AT })
  })

  it.each(['wheel', 'touchMove'] as const)('stops following after a %s on the score until the bar changes', (kind) => {
    const { request, update, scrollEl } = setup()
    const first = request()

    fireEvent[kind](scrollEl)
    update({ target: target(0, 260) })
    expect(request()).toBe(first)

    update({ barIndex: 1 })
    expect(request()).toEqual({ pageIndex: 0, y: 260, at: LINE_AT })
  })

  it('stops following after a press on the scrollbar (on the scroller itself), but not after a tap on a page in it', () => {
    const { request, update, scrollEl } = setup()
    const page = document.createElement('div')
    scrollEl.append(page)
    const first = request()

    fireEvent.pointerDown(page)
    update({ target: target(0, 260), barIndex: 5 })
    expect(request()).not.toBe(first)
    const second = request()

    fireEvent.pointerDown(scrollEl)
    update({ target: target(0, 400), barIndex: 5 })
    expect(request()).toBe(second)
  })

  it('does not take a scroll event for the user: the follow\'s own scrolls report one', () => {
    const { request, update, scrollEl } = setup()

    fireEvent.scroll(scrollEl)
    update({ target: target(0, 260) })

    expect(request()).toEqual({ pageIndex: 0, y: 260, at: LINE_AT })
  })

  it('resumes at once on the current line when the bar changes to a bar on the line it was on', () => {
    const { request, update, scrollEl } = setup()
    const first = request()

    fireEvent.wheel(scrollEl)
    update({ barIndex: 1 })

    expect(request()).not.toBe(first)
    expect(request()).toEqual({ pageIndex: 0, y: 100, at: LINE_AT })
  })

  it('resumes when play starts, also with no bar change', () => {
    const { request, update, scrollEl } = setup()
    const first = request()

    fireEvent.wheel(scrollEl)
    update({ playing: true })

    expect(request()).not.toBe(first)
    expect(request()).toEqual({ pageIndex: 0, y: 100, at: LINE_AT })
  })

  it('does not take a pause as a reason to scroll', () => {
    const { request, update } = setup({ playing: true })
    const first = request()

    update({ playing: false })

    expect(request()).toBe(first)
  })

  it('stops listening when it unmounts', () => {
    const { unmount, scrollEl } = setup()

    unmount()

    expect(() => fireEvent.wheel(scrollEl)).not.toThrow()
  })
})
