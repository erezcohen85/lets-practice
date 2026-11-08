import { act, renderHook } from '@testing-library/react'
import { usePoll } from '@/lib/usePoll'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

describe('usePoll', () => {
  it('loads at once and again every interval while the condition holds', async () => {
    let count = 0
    const load = vi.fn(async () => ++count)
    const { result } = renderHook(() => usePoll(load, { intervalMs: 1000, while: (value) => value < 3 }))

    expect(result.current.value).toBeUndefined()
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.value).toBe(1)

    await advance(1000)
    expect(result.current.value).toBe(2)
    await advance(1000)
    expect(result.current.value).toBe(3)
  })

  it('stops when the condition turns false', async () => {
    let count = 0
    const load = vi.fn(async () => ++count)
    renderHook(() => usePoll(load, { intervalMs: 1000, while: (value) => value < 3 }))

    await advance(10_000)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('does not poll at all when the first value already ends it', async () => {
    const load = vi.fn(async () => 'done')
    renderHook(() => usePoll(load, { intervalMs: 1000, while: () => false }))

    await advance(10_000)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('stops on unmount', async () => {
    const load = vi.fn(async () => 'running')
    const { unmount } = renderHook(() => usePoll(load, { intervalMs: 1000, while: () => true }))

    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    unmount()
    await advance(10_000)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('ignores a load that finishes after unmount', async () => {
    let finish: (value: string) => void = () => {}
    const load = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)))
    const { result, unmount } = renderHook(() => usePoll(load, { intervalMs: 1000, while: () => true }))

    await settle()
    unmount()
    await act(async () => finish('late'))
    await advance(5000)
    expect(result.current.value).toBeUndefined()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('never runs two loads at once, however slow a load is or when reload is called', async () => {
    let running = 0
    let mostAtOnce = 0
    const load = vi.fn(async () => {
      running += 1
      mostAtOnce = Math.max(mostAtOnce, running)
      await new Promise((resolve) => setTimeout(resolve, 2500))
      running -= 1
      return 'x'
    })
    const { result } = renderHook(() => usePoll(load, { intervalMs: 1000, while: () => true }))

    await advance(1000)
    act(() => result.current.reload())
    await advance(19_000)

    expect(mostAtOnce).toBe(1)
    expect(load.mock.calls.length).toBeGreaterThan(3)
  })

  it('stops on an error and keeps it until reload, which clears it and tries again', async () => {
    let fail = true
    const load = vi.fn(async () => {
      if (fail) throw new Error('boom')
      return 'ok'
    })
    const { result } = renderHook(() => usePoll(load, { intervalMs: 1000, while: () => true }))

    await settle()
    expect(result.current.error).toEqual(new Error('boom'))
    await advance(5000)
    expect(load).toHaveBeenCalledTimes(1)

    fail = false
    act(() => result.current.reload())
    expect(result.current.error).toBeUndefined()
    await settle()
    expect(result.current.value).toBe('ok')
    expect(result.current.error).toBeUndefined()
    await advance(1000)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('reload starts polling again after the condition had stopped it', async () => {
    let count = 0
    const load = vi.fn(async () => ++count)
    const { result } = renderHook(() => usePoll(load, { intervalMs: 1000, while: (value) => value < 2 }))

    await advance(5000)
    expect(result.current.value).toBe(2)
    expect(load).toHaveBeenCalledTimes(2)

    act(() => result.current.reload())
    await settle()
    expect(result.current.value).toBe(3)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('waits while it is not enabled and loads when it becomes enabled', async () => {
    const load = vi.fn(async () => 'v')
    const { result, rerender } = renderHook(
      ({ enabled }) => usePoll(load, { intervalMs: 1000, while: () => false, enabled }),
      { initialProps: { enabled: false } },
    )

    await advance(3000)
    expect(load).not.toHaveBeenCalled()
    expect(result.current.value).toBeUndefined()

    rerender({ enabled: true })
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.value).toBe('v')
  })

  it('uses the latest load and condition without restarting', async () => {
    const { result, rerender } = renderHook(
      ({ tag }) => usePoll(async () => tag, { intervalMs: 1000, while: () => true }),
      { initialProps: { tag: 'first' } },
    )

    await settle()
    expect(result.current.value).toBe('first')
    rerender({ tag: 'second' })
    await advance(1000)
    expect(result.current.value).toBe('second')
  })
})
