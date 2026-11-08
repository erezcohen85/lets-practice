import { act, renderHook } from '@testing-library/react'
import { createFakePlayer, type FakePlayer } from '@/lib/fakes/fakePlayer'
import { useTransport } from '@/lib/useTransport'

// Frames are driven by hand, so a test sees exactly when the hook asks for one and when it stops.
let frames: Map<number, FrameRequestCallback>
let nextFrame: number

beforeEach(() => {
  frames = new Map()
  nextFrame = 1
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback)
    return nextFrame++
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Runs the frame that is waiting, if any. */
function runFrame(): void {
  const next = frames.entries().next()
  if (next.done) return
  const [id, callback] = next.value
  frames.delete(id)
  act(() => callback(0))
}

async function loadedTransport(player: FakePlayer = createFakePlayer(100)) {
  const view = renderHook(({ url }) => useTransport(player, url), { initialProps: { url: 'blob:a' as string | null } })
  await act(async () => {})
  return { player, ...view }
}

describe('useTransport', () => {
  it('is not ready without a url, and does not load', () => {
    const player = createFakePlayer()
    const load = vi.spyOn(player, 'load')
    const { result } = renderHook(() => useTransport(player, null))

    expect(result.current).toMatchObject({ ready: false, playing: false, timeSec: 0, durationSec: null, error: false })
    expect(load).not.toHaveBeenCalled()
  })

  it('loads the url and is ready with the duration', async () => {
    const { player, result } = await loadedTransport()

    expect(player.loadedUrl).toBe('blob:a')
    expect(result.current).toMatchObject({ ready: true, playing: false, timeSec: 0, durationSec: 100, error: false })
  })

  it('reports an error when the recording does not load', async () => {
    const player = createFakePlayer()
    const { result } = renderHook(() => useTransport(player, 'fail:x'))
    await act(async () => {})

    expect(result.current).toMatchObject({ ready: false, error: true })
  })

  it('loads a new url and forgets the old one', async () => {
    const { player, result, rerender } = await loadedTransport()
    act(() => player.seek(40))
    expect(result.current.timeSec).toBe(40)

    rerender({ url: 'blob:b' })
    expect(result.current.ready).toBe(false)
    await act(async () => {})

    expect(player.loadedUrl).toBe('blob:b')
    expect(result.current).toMatchObject({ ready: true, timeSec: 0 })
  })

  it('clears the error when the url changes to a good one', async () => {
    const player = createFakePlayer()
    const { result, rerender } = renderHook(({ url }) => useTransport(player, url), {
      initialProps: { url: 'fail:x' as string | null },
    })
    await act(async () => {})
    expect(result.current.error).toBe(true)

    rerender({ url: 'blob:b' })
    await act(async () => {})

    expect(result.current).toMatchObject({ ready: true, error: false })
  })

  it('toggles between playing and paused', async () => {
    const { player, result } = await loadedTransport()

    await act(async () => result.current.toggle())
    expect(result.current.playing).toBe(true)
    expect(player.isPlaying()).toBe(true)

    await act(async () => result.current.toggle())
    expect(result.current.playing).toBe(false)
    expect(player.isPlaying()).toBe(false)
  })

  it('does not play before it is ready', async () => {
    const player = createFakePlayer()
    const { result } = renderHook(() => useTransport(player, null))

    await act(async () => result.current.toggle())

    expect(player.isPlaying()).toBe(false)
    expect(result.current.playing).toBe(false)
  })

  it('seeks the player and shows the new time at once', async () => {
    const { player, result } = await loadedTransport()

    act(() => result.current.seek(33.5))

    expect(player.getTime()).toBe(33.5)
    expect(result.current.timeSec).toBe(33.5)
  })

  it('shows the time of the player on every frame while playing', async () => {
    const { player, result } = await loadedTransport()
    await act(async () => result.current.toggle())

    expect(frames.size).toBe(1)
    act(() => player.advance(2))
    runFrame()
    expect(result.current.timeSec).toBe(2)
    act(() => player.advance(1.5))
    runFrame()

    expect(result.current.timeSec).toBe(3.5)
    expect(frames.size).toBe(1) // asked for the next frame
  })

  it('asks for no frame while paused, and stops the loop on pause', async () => {
    const { player, result } = await loadedTransport()
    expect(frames.size).toBe(0)
    await act(async () => result.current.toggle())
    expect(frames.size).toBe(1)

    await act(async () => result.current.toggle())

    expect(frames.size).toBe(0)
    expect(player.isPlaying()).toBe(false)
  })

  it('shows the end time and stops when the recording ends', async () => {
    const { player, result } = await loadedTransport(createFakePlayer(10))
    await act(async () => result.current.toggle())

    act(() => player.advance(30))

    expect(result.current).toMatchObject({ playing: false, timeSec: 10 })
    expect(frames.size).toBe(0)
  })

  it('follows a player that is played from outside', async () => {
    const { player, result } = await loadedTransport()

    await act(async () => player.play())
    expect(result.current.playing).toBe(true)
    act(() => player.pause())

    expect(result.current.playing).toBe(false)
  })

  it('stops its frame loop and its subscription on unmount', async () => {
    const { player, result, unmount } = await loadedTransport()
    await act(async () => result.current.toggle())
    expect(frames.size).toBe(1)

    unmount()

    expect(frames.size).toBe(0)
    expect(() => act(() => player.advance(1))).not.toThrow()
  })

  it('ignores a load that finishes after unmount', async () => {
    const player = createFakePlayer()
    let finish: () => void = () => {}
    vi.spyOn(player, 'load').mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const { unmount } = renderHook(() => useTransport(player, 'blob:slow'))

    unmount()

    await expect(Promise.resolve().then(finish)).resolves.toBeUndefined()
  })
})
