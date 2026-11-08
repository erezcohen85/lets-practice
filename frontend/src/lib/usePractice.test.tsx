import { act, renderHook } from '@testing-library/react'
import { type ReactNode } from 'react'
import { straightMap } from '@/domain/fixtures'
import { type CountInFade } from '@/domain/countInFade'
import { buildTimeline } from '@/domain/tempo'
import { DEFAULT_PRACTICE_MEMORY, type ListedMark, type PracticeMemory } from '@/domain/types'
import { createFakeClickSynth } from '@/lib/audio/fakeClickSynth'
import { ClientsProvider } from '@/lib/clients'
import { type DataClient } from '@/lib/dataClient'
import { createFakes } from '@/lib/fakes'
import { createFakePlayer } from '@/lib/fakes/fakePlayer'
import { usePractice, type PracticeControls } from '@/lib/usePractice'

const PIECE_ID = 'piece-clark-county'

// Frames are driven by hand, as in useTransport.test; timers and the clock are vitest's fakes.
let frames: Map<number, FrameRequestCallback>
let nextFrame: number

beforeEach(() => {
  frames = new Map()
  nextFrame = 1
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback)
    return nextFrame++
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** 40 bars of 4/4, 2 s each from 1.0 s (a 0.5 s beat); bar 13 starts at 25 s. */
const evenTimeline = buildTimeline(straightMap(40).timing)

/** The same, but bar 12 lasts 4 s (a 1.0 s beat): bar 13 starts at 27 s. */
const slowTwelveTimeline = (() => {
  const { timing } = straightMap(40)
  return buildTimeline({ ...timing, locators: timing.locators.map((l) => (l.bar >= 13 ? { ...l, timeSec: l.timeSec + 2 } : l)) })
})()
const FERMATA_TWELVE: ListedMark[] = [{ bar: 12, kind: 'fermata' }]

// Loop 13-24: positions 12..23.
const LOOP_13_24 = { startPosition: 12, endPosition: 23 }

interface SetupOptions {
  timeline?: typeof evenTimeline
  marks?: ListedMark[]
  memory?: Partial<PracticeMemory>
  countInBars?: 0 | 1 | 2 | 3 | 4
  durationSec?: number
  countInFade?: CountInFade
  data?: (real: DataClient) => DataClient
}

async function setup(options: SetupOptions = {}) {
  const fakes = createFakes({ seed: 'demo' })
  const player = createFakePlayer(options.durationSec ?? 100)
  await player.load('blob:recording')
  const synth = createFakeClickSynth()
  const data = options.data === undefined ? fakes.data : options.data(fakes.data)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ClientsProvider clients={{ data, processor: fakes.processor }}>{children}</ClientsProvider>
  )
  // What the page passes as the fade: a test changes it and rerenders, as the Playback panel does.
  const fade = { current: options.countInFade ?? 'off' }
  // What the page passes as the marks: the fermatas and the rests of the part on the stand, which change with the part.
  const marks = { current: options.marks ?? [] }
  const view = renderHook(
    () =>
      usePractice({
        player,
        synth,
        timeline: options.timeline ?? evenTimeline,
        marks: marks.current,
        pieceId: PIECE_ID,
        initialCountInBars: options.countInBars ?? 1,
        countInFade: fade.current,
        initialMemory: { ...DEFAULT_PRACTICE_MEMORY, ...options.memory },
      }),
    { wrapper },
  )
  const controlsOf = () => view.result.current[1]
  const state = () => view.result.current[0]

  /** Lets wall seconds pass: the player moves by them × its rate, timers fire, then one frame runs. */
  function elapse(wallSec: number): void {
    act(() => {
      player.advance(wallSec)
      vi.advanceTimersByTime(wallSec * 1000)
    })
    runFrame()
  }
  function runFrame(): void {
    const next = frames.entries().next()
    if (next.done) return
    const [id, callback] = next.value
    frames.delete(id)
    act(() => callback(0))
  }
  /** Runs `change` with the controls inside act. */
  const run = (change: (controls: PracticeControls) => void) => act(() => change(controlsOf()))
  return { fakes, player, synth, state, run, elapse, runFrame, fade, marks, ...view }
}

const clickWalls = (synth: { scheduled: { delaySec: number }[] }) => synth.scheduled.map((c) => Number(c.delaySec.toFixed(4)))

describe('usePractice: the memory', () => {
  it('opens on the remembered values', async () => {
    const { state, player } = await setup({
      memory: {
        speed: 0.75,
        musicVolume: 0.4,
        metronome: { on: true, volume: 0.5, tone: 'beep' },
        loop: LOOP_13_24,
        countInEveryRepeat: true,
      },
      countInBars: 2,
    })

    expect(state()).toMatchObject({
      phase: 'idle',
      speed: 0.75,
      range: LOOP_13_24,
      looping: true,
      countInBars: 2,
      countInEveryRepeat: true,
      tempoSource: 'loop-first-bar',
      musicVolume: 0.4,
      metronome: { on: true, volume: 0.5, tone: 'beep' },
    })
    expect(player.getVolume()).toBe(0.4)
  })

  it('opens on the defaults and ignores a remembered loop that is not in the timeline', async () => {
    const { state } = await setup({ memory: { loop: { startPosition: 30, endPosition: 99 } } })

    expect(state()).toMatchObject({ range: null, looping: false, speed: 1, musicVolume: 1, metronome: { on: false, volume: 0.8, tone: 'wood' }, countInEveryRepeat: false })
  })

  it('saves the memory on the piece once, 500 ms after a change', async () => {
    const { fakes, run } = await setup()
    const save = vi.spyOn(fakes.data, 'savePracticeMemory')

    run((c) => c.setMusicVolume(0.5))
    act(() => void vi.advanceTimersByTime(499))
    expect(save).not.toHaveBeenCalled()
    run((c) => c.setSpeed(0.75))
    run((c) => c.setMetronome({ on: true, tone: 'click' }))
    run((c) => c.setRange(LOOP_13_24))
    run((c) => c.setCountInEveryRepeat(true))
    await act(async () => void vi.advanceTimersByTime(1))

    expect(save).toHaveBeenCalledTimes(1)
    expect((await fakes.data.getPiece(PIECE_ID))?.piece.practice).toEqual({
      metronome: { on: true, volume: 0.8, tone: 'click' },
      musicVolume: 0.5,
      speed: 0.75,
      loop: LOOP_13_24,
      loopOn: true,
      countInEveryRepeat: true,
      countInMetronome: true,
    })
  })

  it('opens with looping off, the range kept, when it was off when left, and saves a change of looping alone', async () => {
    const { fakes, state, run } = await setup({ memory: { loop: LOOP_13_24, loopOn: false } })
    expect(state()).toMatchObject({ range: LOOP_13_24, looping: false })
    const save = vi.spyOn(fakes.data, 'savePracticeMemory')

    run((c) => c.setLooping(true))
    await act(async () => void vi.advanceTimersByTime(500))
    run((c) => c.playFrom(30))
    await act(async () => void vi.advanceTimersByTime(500))

    expect(save.mock.calls.map(([, memory]) => [memory.loop, memory.loopOn])).toEqual([
      [LOOP_13_24, true],
      [LOOP_13_24, false],
    ])
  })

  it('saves at most once per 500 ms across a run of changes', async () => {
    const { fakes, run } = await setup()
    const save = vi.spyOn(fakes.data, 'savePracticeMemory')

    for (let i = 1; i <= 10; i++) {
      run((c) => c.setMusicVolume(i / 10))
      await act(async () => void vi.advanceTimersByTime(100))
    }
    await act(async () => void vi.advanceTimersByTime(500))

    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls.at(-1)?.[1].musicVolume).toBe(1)
  })

  it('saves what is unsaved when the page is left, and nothing when all is saved', async () => {
    const { fakes, run, unmount } = await setup()
    const save = vi.spyOn(fakes.data, 'savePracticeMemory')

    run((c) => c.setMusicVolume(0.3))
    unmount()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][1].musicVolume).toBe(0.3)
    await act(async () => void vi.advanceTimersByTime(1000))
    expect(save).toHaveBeenCalledTimes(1)

    const second = await setup()
    const saveSecond = vi.spyOn(second.fakes.data, 'savePracticeMemory')
    second.unmount()
    expect(saveSecond).not.toHaveBeenCalled()
  })

  it('does not save the tempo source', async () => {
    const { fakes, run, state } = await setup()
    const save = vi.spyOn(fakes.data, 'savePracticeMemory')

    run((c) => c.setTempoSource('bar-before'))
    await act(async () => void vi.advanceTimersByTime(1000))

    expect(state().tempoSource).toBe('bar-before')
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps the values on screen when a save fails and tries again with the next change', async () => {
    let failing = true
    const { fakes, run, state } = await setup({
      data: (real) => ({
        ...real,
        savePracticeMemory: (id, memory) => (failing ? Promise.reject(new Error('offline')) : real.savePracticeMemory(id, memory)),
      }),
    })

    run((c) => c.setMusicVolume(0.4))
    await act(async () => void vi.advanceTimersByTime(500))
    expect(state().musicVolume).toBe(0.4)
    expect((await fakes.data.getPiece(PIECE_ID))?.piece.practice.musicVolume).toBe(1)

    failing = false
    run((c) => c.setSpeed(1.5))
    await act(async () => void vi.advanceTimersByTime(500))

    expect(await fakes.data.getPiece(PIECE_ID).then((d) => d?.piece.practice)).toMatchObject({ musicVolume: 0.4, speed: 1.5 })
  })

  it('saves the count-in length on the piece at once', async () => {
    const { fakes, run, state } = await setup()

    run((c) => c.setCountInBars(3))
    await act(async () => {})

    expect(state().countInBars).toBe(3)
    expect((await fakes.data.getPiece(PIECE_ID))?.piece.countInBars).toBe(3)
  })
})

describe('usePractice: volumes and the metronome settings', () => {
  it('sets the music volume on the player, clamped, and ignores a value that is not a number', async () => {
    const { player, run, state } = await setup()

    run((c) => c.setMusicVolume(0.25))
    expect(player.getVolume()).toBe(0.25)
    run((c) => c.setMusicVolume(7))
    expect(state().musicVolume).toBe(1)
    run((c) => c.setMusicVolume(Number.NaN))
    expect(state().musicVolume).toBe(1)
  })

  it('refuses a tone it does not know and clamps the click volume', async () => {
    const { run, state } = await setup()

    run((c) => c.setMetronome({ tone: 'cowbell' as never, volume: 4 }))

    expect(state().metronome).toMatchObject({ tone: 'wood', volume: 1 })
  })

  it('shows the local tempo at the cursor times the speed', async () => {
    const { run, state, player, elapse } = await setup({ memory: { speed: 0.5 } })

    expect(state().metronome.bpm).toBeNull() // time 0 is before the first bar
    run((c) => c.playFrom(12))
    elapse(0.1)
    expect(player.getTime()).toBeCloseTo(25.05)
    expect(state().metronome.bpm).toBeCloseTo(120 * 0.5)
    run((c) => c.setSpeed(0.75))
    expect(state().metronome.bpm).toBeCloseTo(120 * 0.75)
  })
})

describe('usePractice: moving outside the loop', () => {
  it('keeps looping when a bar inside the range is played from', async () => {
    const { run, state } = await setup({ memory: { loop: LOOP_13_24 } })

    run((c) => c.playFrom(15))

    expect(state()).toMatchObject({ looping: true, range: LOOP_13_24 })
  })

  it('turns looping off, keeping the range, when a bar outside it is played from', async () => {
    const { run, state } = await setup({ memory: { loop: LOOP_13_24 } })

    run((c) => c.playFrom(30))

    expect(state()).toMatchObject({ looping: false, range: LOOP_13_24 })
  })

  it('turns looping off when the player is sought outside the range, and not when it is sought inside', async () => {
    const { run, state, player } = await setup({ memory: { loop: LOOP_13_24 } })

    act(() => player.seek(30))
    expect(state().looping).toBe(true) // bar 13 starts at 25 s and bar 24 ends at 49 s: 30 s is inside
    act(() => player.seek(10))
    expect(state()).toMatchObject({ looping: false, range: LOOP_13_24 })
    run((c) => c.setLooping(true))
    act(() => player.seek(49))
    expect(state().looping).toBe(false)
  })

  it('reads a seek to the loop start that comes back a hair early as inside', async () => {
    const { state, player } = await setup({ memory: { loop: LOOP_13_24 } })

    act(() => player.seek(24.99))

    expect(state().looping).toBe(true)
  })

  it('does not take the pre-roll of a count-in for a move outside the loop', async () => {
    const { run, state } = await setup({ memory: { loop: LOOP_13_24 } })

    run((c) => c.restartLoop())

    expect(state()).toMatchObject({ phase: 'counting', looping: true })
  })

  it('turns looping back on at the loop start with setLooping(true), without playing', async () => {
    const { run, state, player } = await setup({ memory: { loop: LOOP_13_24 } })
    run((c) => c.playFrom(30))

    run((c) => c.setLooping(true))

    expect(state()).toMatchObject({ looping: true, range: LOOP_13_24 })
    expect(player.getTime()).toBe(25)
  })

  it('turns looping off with setLooping(false) and ignores setLooping(true) with no range', async () => {
    const { run, state } = await setup({ memory: { loop: LOOP_13_24 } })

    run((c) => c.setLooping(false))
    expect(state()).toMatchObject({ looping: false, range: LOOP_13_24 })

    const empty = await setup()
    empty.run((c) => c.setLooping(true))
    expect(empty.state().looping).toBe(false)
  })

  it('puts a loop back with setLoop, on or off, without a seek, and drops it with null', async () => {
    const { run, state, player } = await setup({ memory: { loop: LOOP_13_24 } })
    run((c) => c.playFrom(30))
    const time = player.getTime()

    run((c) => c.setLoop(null, false))
    expect(state()).toMatchObject({ range: null, looping: false })
    run((c) => c.setLoop(LOOP_13_24, true))
    expect(state()).toMatchObject({ range: LOOP_13_24, looping: true })
    run((c) => c.setLoop(LOOP_13_24, false))
    expect(state()).toMatchObject({ range: LOOP_13_24, looping: false })
    run((c) => c.setLoop(null, true))
    expect(state()).toMatchObject({ range: null, looping: false })
    expect(player.getTime()).toBe(time)
  })

  it('plays on from where it is, with no wrap, after looping was turned off', async () => {
    const { run, player, elapse } = await setup({ memory: { loop: LOOP_13_24 }, countInBars: 0 })
    act(() => player.seek(10))

    run((c) => c.playPause())
    elapse(60)

    expect(player.getTime()).toBe(70)
  })

  it('restarts the loop from its start and turns looping on again', async () => {
    const { run, state, player } = await setup({ memory: { loop: LOOP_13_24 }, countInBars: 0 })
    run((c) => c.playFrom(30))

    run((c) => c.restartLoop())

    expect(state()).toMatchObject({ looping: true, phase: 'playing' })
    expect(player.getTime()).toBe(25)
  })
})

describe('usePractice: playing', () => {
  it('plays on from a bar without a loop', async () => {
    const { player, run, state, elapse } = await setup({ memory: { loop: LOOP_13_24 } })

    run((c) => c.playFrom(4))
    expect(player.isPlaying()).toBe(true)
    expect(player.getTime()).toBe(9)
    expect(state()).toMatchObject({ phase: 'playing', looping: false, count: null, range: LOOP_13_24 })
    elapse(60) // far past the range end: no wrap
    expect(player.getTime()).toBe(69)
  })

  it('plays the recording on from the position with no range (count-in off)', async () => {
    const { player, run, state, elapse } = await setup({ countInBars: 0 })

    run((c) => c.playPause())
    expect(state().phase).toBe('playing')
    elapse(2)
    expect(state().timeSec).toBe(2)
    run((c) => c.playPause())
    expect(state().phase).toBe('paused')
    expect(player.isPlaying()).toBe(false)
    run((c) => c.playPause())
    expect(player.isPlaying()).toBe(true)
    expect(player.getTime()).toBe(2)
  })

  it('keeps recording-time positions when the speed changes', async () => {
    const { player, run, state, elapse } = await setup()

    run((c) => c.playFrom(12))
    elapse(1)
    expect(state().timeSec).toBe(26)
    run((c) => c.setSpeed(0.5))
    expect(state().timeSec).toBe(26)
    elapse(2)
    expect(player.getTime()).toBe(27)
    expect(state()).toMatchObject({ speed: 0.5, timeSec: 27 })
  })

  it('takes any speed from 0.25 to 2 and snaps it to 0.05: the player and the state follow the slider', async () => {
    const { player, run, state } = await setup()

    run((c) => c.setSpeed(0.85))
    expect(state().speed).toBe(0.85)
    expect(player.getRate()).toBe(0.85)
    run((c) => c.setSpeed(1.23))
    expect(state().speed).toBe(1.25)
    run((c) => c.setSpeed(0.25))
    expect(state().speed).toBe(0.25)
    run((c) => c.setSpeed(2))
    expect(state().speed).toBe(2)
  })

  it('refuses a speed outside the range or not a number', async () => {
    const { run, state } = await setup()

    for (const rate of [0.2, 2.1, 0, -1, Number.NaN]) run((c) => c.setSpeed(rate))

    expect(state().speed).toBe(1)
  })

  it('reopens on a saved speed between the old steps', async () => {
    const { state } = await setup({ memory: { speed: 0.85 } })

    expect(state().speed).toBe(0.85)
  })

  it('offers the speed range in the state, for the slider', async () => {
    const { state } = await setup()

    expect(state().speedRange).toEqual({ min: 0.25, max: 2, step: 0.05 })
  })

  describe('a live drag of the speed', () => {
    it('changes the rate at once but leaves a click count-in running until the release', async () => {
      const { player, run, state, synth, elapse } = await setup({ timeline: slowTwelveTimeline, marks: FERMATA_TWELVE, memory: { loop: LOOP_13_24 } })
      run((c) => c.playPause())
      expect(state()).toMatchObject({ phase: 'counting', count: { beat: 1, of: 4 } })
      elapse(0.6) // the second count is under way
      expect(state().count).toEqual({ beat: 2, of: 4 })

      run((c) => c.setSpeed(0.9, { live: true }))
      run((c) => c.setSpeed(0.85, { live: true }))
      expect(player.getRate()).toBe(0.85)
      expect(state()).toMatchObject({ speed: 0.85, phase: 'counting', count: { beat: 2, of: 4 } })

      synth.scheduled.length = 0
      run((c) => c.commitSpeed())
      expect(state()).toMatchObject({ speed: 0.85, phase: 'counting', count: { beat: 1, of: 4 } })
      // The count-in is planned again at the new speed: the counts are 0.5 / 0.85 s apart.
      expect(clickWalls(synth)).toEqual([0, 0.5882, 1.1765, 1.7647])
    })

    it('counts in again at once for a speed set without a drag (a menu choice, Back to 1x)', async () => {
      const { run, state, elapse } = await setup({ timeline: slowTwelveTimeline, marks: FERMATA_TWELVE, memory: { loop: LOOP_13_24 } })
      run((c) => c.playPause())
      elapse(0.6)

      run((c) => c.setSpeed(0.5))

      expect(state()).toMatchObject({ speed: 0.5, phase: 'counting', count: { beat: 1, of: 4 } })
    })

    it('does nothing at the release when no count-in is running, or when the speed did not move', async () => {
      const { run, state, elapse } = await setup({ timeline: slowTwelveTimeline, marks: FERMATA_TWELVE, memory: { loop: LOOP_13_24 } })
      run((c) => c.playPause())
      elapse(0.6)
      run((c) => c.commitSpeed())
      expect(state().count).toEqual({ beat: 2, of: 4 })

      run((c) => c.setLooping(true))
      run((c) => c.setSpeed(0.7, { live: true }))
      elapse(5) // the count-in ends under the drag
      expect(state().phase).toBe('playing')
      run((c) => c.commitSpeed())
      expect(state()).toMatchObject({ phase: 'playing', speed: 0.7 })
    })

    it('saves the speed the drag ends on', async () => {
      const { fakes, run } = await setup()
      const save = vi.spyOn(fakes.data, 'savePracticeMemory')

      for (const rate of [0.6, 0.65, 0.7]) run((c) => c.setSpeed(rate, { live: true }))
      run((c) => c.commitSpeed())
      await act(async () => void vi.advanceTimersByTime(500))

      expect(save).toHaveBeenCalledTimes(1)
      expect(save.mock.calls[0][1].speed).toBe(0.7)
    })
  })
})

describe('usePractice: mute', () => {
  it('silences the music without touching the volume that is kept and saved', async () => {
    const { fakes, player, run, state } = await setup({ memory: { musicVolume: 0.6 } })
    const save = vi.spyOn(fakes.data, 'savePracticeMemory')

    run((c) => c.setMuted(true))

    expect(state()).toMatchObject({ muted: true, musicVolume: 0.6 })
    expect(player.getVolume()).toBe(0)
    run((c) => c.setMuted(false))
    expect(state()).toMatchObject({ muted: false, musicVolume: 0.6 })
    expect(player.getVolume()).toBe(0.6)
    await act(async () => void vi.advanceTimersByTime(1000))
    expect(save).not.toHaveBeenCalled()
  })

  it('is not part of the saved memory, and a new visit opens unmuted', async () => {
    const { fakes, run } = await setup()
    const save = vi.spyOn(fakes.data, 'savePracticeMemory')

    run((c) => c.setMuted(true))
    run((c) => c.setMetronome({ tone: 'click' }))
    await act(async () => void vi.advanceTimersByTime(500))

    expect(save.mock.calls[0][1]).not.toHaveProperty('muted')
    expect(save.mock.calls[0][1].musicVolume).toBe(1)
  })

  it('unmutes when the volume slider moves, at the new volume', async () => {
    const { player, run, state } = await setup()
    run((c) => c.setMuted(true))

    run((c) => c.setMusicVolume(0.3))

    expect(state()).toMatchObject({ muted: false, musicVolume: 0.3 })
    expect(player.getVolume()).toBe(0.3)
  })

  it('stays muted when a new play starts, and does not mute the metronome clicks', async () => {
    const { player, run, state, synth, elapse } = await setup({ timeline: slowTwelveTimeline, marks: FERMATA_TWELVE, memory: { loop: LOOP_13_24 } })
    run((c) => c.setMuted(true))

    run((c) => c.playPause()) // a click count-in: the clicks are the metronome's, not the music's
    expect(synth.scheduled.length).toBeGreaterThan(0)
    elapse(5) // the count-in is over and the music plays

    expect(state()).toMatchObject({ phase: 'playing', muted: true })
    expect(player.getVolume()).toBe(0)
  })
})

describe('usePractice: leaving', () => {
  it('stops the frames, the timers and the clicks on unmount, and leaves the player alone', async () => {
    const { player, run, synth, unmount } = await setup({
      timeline: slowTwelveTimeline,
      marks: FERMATA_TWELVE,
      memory: { loop: LOOP_13_24 },
    })
    run((c) => c.playPause()) // a click count-in is running

    unmount()

    expect(frames.size).toBe(0)
    expect(synth.scheduled).toEqual([])
    act(() => void vi.advanceTimersByTime(10_000))
    expect(player.isPlaying()).toBe(false)
  })
})

describe('usePractice: the count-in', () => {
  it('starts at once with the count-in off', async () => {
    const { player, run, state, synth } = await setup({ countInBars: 0, memory: { loop: LOOP_13_24 } })

    run((c) => c.playPause())

    expect(state()).toMatchObject({ phase: 'playing', count: null })
    expect(player.isPlaying()).toBe(true)
    expect(player.getTime()).toBe(25)
    expect(synth.scheduled).toEqual([])
  })

  it('pre-roll: replays the bar before the loop, counting 1 to 4, and the loop starts at bar 13', async () => {
    const { player, run, state, elapse } = await setup({ memory: { loop: LOOP_13_24 } })

    run((c) => c.playPause())
    expect(player.getTime()).toBe(23) // the start of bar 12
    expect(state()).toMatchObject({ phase: 'counting', count: { beat: 1, of: 4 } })
    const beats: number[] = []
    for (let i = 0; i < 4; i++) {
      beats.push(state().count?.beat ?? 0)
      if (i < 3) elapse(0.5)
    }
    expect(beats).toEqual([1, 2, 3, 4])
    elapse(0.5)
    expect(state()).toMatchObject({ phase: 'playing', count: null })
    expect(state().timeSec).toBe(25)
  })

  describe('the metronome in the count-in (Erez, 2026-11-04)', () => {
    const REST_TWELVE: ListedMark[] = [{ bar: 12, kind: 'rest' }]

    it('clicks over the pre-roll bars with the metronome off for the music, and stops at the loop start', async () => {
      const { run, state, synth, elapse } = await setup({ memory: { loop: LOOP_13_24 } })

      run((c) => c.playPause())
      elapse(0.4) // the recording is in the pre-roll bar, a beat every 0.5 s
      expect(state().phase).toBe('counting')
      expect(synth.scheduled.length).toBeGreaterThan(0)
      elapse(1.7)
      expect(state().phase).toBe('playing')
      const during = synth.scheduled.length
      elapse(1)
      expect(synth.scheduled.length).toBe(during)
    })

    it('leaves the pre-roll without clicks when it is off', async () => {
      const { run, synth, elapse } = await setup({ memory: { loop: LOOP_13_24, countInMetronome: false } })

      run((c) => c.playPause())
      elapse(0.4)

      expect(synth.scheduled).toEqual([])
    })

    it('makes a click count-in silent when it is off', async () => {
      const { run, state, player, synth } = await setup({ marks: REST_TWELVE, memory: { loop: LOOP_13_24, countInMetronome: false } })

      run((c) => c.playPause())

      expect(state()).toMatchObject({ phase: 'counting', count: { beat: 1, of: 4 } })
      expect(player.getTime()).toBe(25)
      expect(synth.scheduled).toEqual([])
    })

    it('is switched from the controls and remembered', async () => {
      const { run, state } = await setup()
      expect(state().countInMetronome).toBe(true)

      run((c) => c.setCountInMetronome(false))

      expect(state().countInMetronome).toBe(false)
    })
  })

  it('a rest in the part on the stand turns the pre-roll into clicks, and another part without it pre-rolls again', async () => {
    const REST_TWELVE: ListedMark[] = [{ bar: 12, kind: 'rest' }]
    const { player, run, state, marks, rerender, synth } = await setup({ marks: REST_TWELVE, memory: { loop: LOOP_13_24 } })

    run((c) => c.playPause())
    expect(player.getTime()).toBe(25) // clicks: the playhead waits at the loop start
    expect(synth.scheduled.length).toBeGreaterThan(0)

    run((c) => c.playPause())
    marks.current = [] // the other part, which plays bar 12
    rerender()
    run((c) => c.playPause())

    expect(player.getTime()).toBe(23) // pre-roll: the bar before the loop is replayed
    expect(state()).toMatchObject({ phase: 'counting' })
  })

  it('pre-roll at 0.75x: the count follows the recorded beats, 0.667 s apart on the wall', async () => {
    const { player, run, state, elapse } = await setup({ memory: { loop: LOOP_13_24, speed: 0.75 } })

    run((c) => c.playPause())
    elapse(0.6667) // 0.5 s of recording
    expect(state().count).toEqual({ beat: 2, of: 4 })
    elapse(2.0001) // 1.5 s more: the loop start
    expect(state().phase).toBe('playing')
    expect(player.getTime()).toBeCloseTo(25, 1)
  })

  it('click count-in after the fermata, from the loop first bar: 4 clicks 0.667 s apart at 0.75x, accent on the first', async () => {
    const { player, run, state, synth, elapse } = await setup({
      timeline: slowTwelveTimeline,
      marks: FERMATA_TWELVE,
      memory: { loop: LOOP_13_24, speed: 0.75 },
    })

    run((c) => c.playPause())

    expect(clickWalls(synth)).toEqual([0, 0.6667, 1.3333, 2])
    expect(synth.scheduled.map((c) => c.accent)).toEqual([true, false, false, false])
    expect(state()).toMatchObject({ phase: 'counting', count: { beat: 1, of: 4 } })
    expect(player.isPlaying()).toBe(false)
    expect(player.getTime()).toBe(27)

    elapse(0.7)
    expect(state().count).toEqual({ beat: 2, of: 4 })
    elapse(1.3)
    expect(state().count).toEqual({ beat: 4, of: 4 })
    expect(player.isPlaying()).toBe(false)
    elapse(0.7) // 2.667 s: after the 4th count
    expect(state()).toMatchObject({ phase: 'playing', count: null })
    expect(player.isPlaying()).toBe(true)
    expect(player.getTime()).toBeCloseTo(27, 5)
  })

  it('click count-in from the bar before the loop takes that bar\'s tempo (1.333 s per count at 0.75x)', async () => {
    const { run, synth } = await setup({
      timeline: slowTwelveTimeline,
      marks: FERMATA_TWELVE,
      memory: { loop: LOOP_13_24, speed: 0.75 },
    })

    run((c) => c.setTempoSource('bar-before'))
    run((c) => c.playPause())

    expect(clickWalls(synth)).toEqual([0, 1.3333, 2.6667, 4])
  })

  it('a new range resets the tempo source to the loop first bar', async () => {
    const { run, state } = await setup()

    run((c) => c.setTempoSource('bar-before'))
    run((c) => c.setRange(LOOP_13_24))

    expect(state().tempoSource).toBe('loop-first-bar')
  })

  it('pausing during a count-in stops it; playing again counts in again', async () => {
    const { player, run, state, synth, elapse } = await setup({
      timeline: slowTwelveTimeline,
      marks: FERMATA_TWELVE,
      memory: { loop: LOOP_13_24 },
    })

    run((c) => c.playPause())
    elapse(1)
    run((c) => c.playPause())
    expect(state()).toMatchObject({ phase: 'paused', count: null })
    expect(synth.scheduled).toEqual([])
    elapse(5)
    expect(player.isPlaying()).toBe(false)

    run((c) => c.playPause())
    expect(state()).toMatchObject({ phase: 'counting', count: { beat: 1, of: 4 } })
  })
})

describe('usePractice: the count-in after a pickup', () => {
  // 6/8 with an eighth of 0.5 s: bar 5 from 12 s holds four eighths, the pickup (bar 6) two from 14 s, bar 7 starts at 15 s.
  const { timing } = straightMap(8)
  const pickupTimeline = buildTimeline({
    ...timing,
    meters: [{ fromBar: 1, numerator: 6, denominator: 8 }],
    shortBars: [{ bar: 6, units: 2, unnumbered: true }],
    locators: [0, 3, 6, 9, 12, 14, 15, 18].map((timeSec, i) => ({ ...timing.locators[i], timeSec })),
  })

  it('replays the bar before the pickup and the pickup as one bar, and counts all of it', async () => {
    const { run, state, player, elapse } = await setup({ timeline: pickupTimeline, memory: { loop: { startPosition: 6, endPosition: 7 } } })

    run((c) => c.playPause())
    expect(state()).toMatchObject({ phase: 'counting', count: { beat: 1, of: 6 }, countAt: 6 })
    expect(player.getTime()).toBe(12)

    elapse(2.5) // the sixth count, on the second eighth of the pickup
    expect(state()).toMatchObject({ phase: 'counting', count: { beat: 6, of: 6 } })

    elapse(0.5)
    expect(state()).toMatchObject({ phase: 'playing', count: null })
    expect(player.getTime()).toBe(15)
  })
})

describe('usePractice: Play after a loop is set', () => {
  // Bar n starts at 1 + 2(n - 1) s: bar 12 (the pre-roll of loop 13-24) at 23 s, bar 13 at 25 s, bar 16 at 31 s.

  it('starts the new loop with its count-in, not the bar selected before it', async () => {
    const { run, state, player } = await setup()
    run((c) => c.selectBar(4))

    run((c) => c.setRange(LOOP_13_24))
    run((c) => c.playPause())

    expect(state()).toMatchObject({ phase: 'counting', countAt: 12, looping: true })
    expect(player.getTime()).toBe(23)
  })

  it('starts from the first bar of the loop when the selected bar is inside it', async () => {
    const { run, state, player } = await setup()
    run((c) => c.selectBar(15))

    run((c) => c.setRange(LOOP_13_24))
    run((c) => c.playPause())

    expect(state()).toMatchObject({ phase: 'counting', countAt: 12 })
    expect(player.getTime()).toBe(23)
  })

  it('goes straight to the loop start with the count-in off', async () => {
    const { run, state, player } = await setup({ countInBars: 0 })
    run((c) => c.selectBar(4))

    run((c) => c.setRange(LOOP_13_24))
    run((c) => c.playPause())

    expect(state().phase).toBe('playing')
    expect(player.getTime()).toBe(25)
  })

  it('starts the loop when the music was paused before the loop was set', async () => {
    const { run, state, player, elapse } = await setup({ countInBars: 0 })
    run((c) => c.playPause())
    elapse(1)
    run((c) => c.playPause())

    run((c) => c.setRange(LOOP_13_24))
    run((c) => c.playPause())

    expect(state().phase).toBe('playing')
    expect(player.getTime()).toBe(25)
  })

  it('starts the loop when a loop set during the music is paused before the music reaches it', async () => {
    const { run, state, player, elapse } = await setup({ countInBars: 0 })
    run((c) => c.playPause())
    run((c) => c.setRange(LOOP_13_24))
    elapse(1)
    run((c) => c.playPause())
    expect(state().phase).toBe('paused')

    run((c) => c.playPause())

    expect(state().phase).toBe('playing')
    expect(player.getTime()).toBe(25)
  })

  it('counts in when the loop is turned back on during a pause', async () => {
    const { run, state, player } = await setup({ memory: { loop: LOOP_13_24, loopOn: false } })
    run((c) => c.selectBar(4))

    run((c) => c.setLooping(true))
    run((c) => c.playPause())

    expect(state()).toMatchObject({ phase: 'counting', countAt: 12 })
    expect(player.getTime()).toBe(23)
  })

  it('a bar selected inside the loop after it was set is where Play goes on from', async () => {
    const { run, state, player } = await setup()
    run((c) => c.setRange(LOOP_13_24))

    run((c) => c.selectBar(15))
    run((c) => c.playPause())

    expect(state()).toMatchObject({ phase: 'playing', looping: true })
    expect(player.getTime()).toBe(31)
  })

  it('a seek inside the loop after it was set is where Play goes on from', async () => {
    const { run, state, player } = await setup()
    run((c) => c.selectBar(4))
    run((c) => c.setRange(LOOP_13_24))

    act(() => player.seek(31))
    run((c) => c.playPause())

    expect(state()).toMatchObject({ phase: 'playing', looping: true })
    expect(player.getTime()).toBe(31)
  })

  it('a pause inside the loop still resumes where it stopped', async () => {
    const { run, state, player, elapse } = await setup({ countInBars: 0 })
    run((c) => c.setRange(LOOP_13_24))
    run((c) => c.playPause())
    elapse(3)
    run((c) => c.playPause())
    const paused = player.getTime()
    expect(paused).toBeGreaterThan(25)

    run((c) => c.playPause())

    expect(state().phase).toBe('playing')
    expect(player.getTime()).toBe(paused)
  })
})

describe('usePractice: the loop', () => {
  async function playingLoop(memory: Partial<PracticeMemory> = {}) {
    const harness = await setup({ countInBars: 1, memory: { loop: LOOP_13_24, ...memory } })
    harness.run((c) => c.playPause())
    harness.elapse(2) // the pre-roll of bar 12
    return harness
  }

  it('wraps from the loop end to the loop start seamlessly with "count in every repeat" off', async () => {
    const { player, state, elapse } = await playingLoop()
    expect(state()).toMatchObject({ phase: 'playing', timeSec: 25 })

    elapse(24) // bar 24 ends at 49
    expect(state()).toMatchObject({ phase: 'playing', count: null })
    expect(player.getTime()).toBe(25)
    expect(player.isPlaying()).toBe(true)
  })

  describe('a loop of one bar', () => {
    // Bar 13 alone: 25 s to 27 s.
    const BAR_13 = { startPosition: 12, endPosition: 12 }

    it('goes round and round, staying on its bar', async () => {
      const { player, state, run, elapse } = await setup({ memory: { loop: BAR_13, loopOn: true }, countInBars: 0 })
      run((c) => c.playPause())
      elapse(0)
      expect(state()).toMatchObject({ phase: 'playing', looping: true })
      expect(player.getTime()).toBe(25)

      for (let round = 0; round < 3; round++) {
        elapse(1)
        expect(player.getTime()).toBe(26)
        elapse(1)
        expect(player.getTime()).toBe(25)
        expect(state()).toMatchObject({ phase: 'playing', looping: true })
      }
      expect(player.isPlaying()).toBe(true)
    })

    it('counts in from the bar before it, then goes round', async () => {
      const { player, state, run, elapse } = await setup({ memory: { loop: BAR_13, loopOn: true }, countInBars: 1 })
      run((c) => c.playPause())
      expect(state()).toMatchObject({ phase: 'counting' })
      expect(player.getTime()).toBe(23)

      elapse(2)
      expect(state()).toMatchObject({ phase: 'playing', count: null })
      elapse(2)
      expect(player.getTime()).toBe(25)
      expect(state()).toMatchObject({ phase: 'playing', looping: true })
    })

    it('counts in again each time with "count in every repeat" on', async () => {
      const { player, state, run, elapse } = await setup({ memory: { loop: BAR_13, loopOn: true, countInEveryRepeat: true }, countInBars: 1 })
      run((c) => c.playPause())
      elapse(2)
      expect(state()).toMatchObject({ phase: 'playing' })

      elapse(2)
      expect(state()).toMatchObject({ phase: 'counting' })
      expect(player.getTime()).toBe(23)
      elapse(2)
      expect(state()).toMatchObject({ phase: 'playing' })
      expect(player.getTime()).toBe(25)
    })
  })

  it('counts in again at the wrap with "count in every repeat" on', async () => {
    const { player, state, elapse } = await playingLoop({ countInEveryRepeat: true })

    elapse(24)

    expect(state()).toMatchObject({ phase: 'counting', count: { beat: 1, of: 4 } })
    expect(player.getTime()).toBe(23)
    elapse(2)
    expect(state()).toMatchObject({ phase: 'playing', count: null })
    expect(player.getTime()).toBe(25)
  })

  describe('wraps before the next bar sounds', () => {
    // The loop 13-24 ends at 49 s. Two ticks 16 ms apart set the frame length, then a tick lands at endSec - before.
    async function frameAt(memory: Partial<PracticeMemory>, before: number, countInBars: 0 | 1 = 0) {
      const harness = await setup({ countInBars, memory: { loop: LOOP_13_24, ...memory } })
      harness.run((c) => c.playPause())
      if (countInBars > 0) harness.elapse(2) // the pre-roll of bar 12
      harness.runFrame()
      harness.elapse(0.016)
      act(() => {
        harness.player.seek(49 - before)
        vi.advanceTimersByTime(16)
      })
      harness.runFrame()
      return harness
    }

    it('wraps at 1x on the tick 10 ms before the loop end (a 16 ms frame)', async () => {
      const { player, state } = await frameAt({}, 0.01)

      expect(player.getTime()).toBe(25)
      expect(state()).toMatchObject({ phase: 'playing', timeSec: 25 })
    })

    it('does not wrap at 1x on the tick 30 ms before the loop end', async () => {
      const { player } = await frameAt({}, 0.03)

      expect(player.getTime()).toBeCloseTo(48.97)
    })

    it('looks ahead by a frame of recording time: at 2x a tick 25 ms before the end wraps, at 1x it does not', async () => {
      const fast = await frameAt({ speed: 2 }, 0.025)
      expect(fast.player.getTime()).toBe(25)

      const normal = await frameAt({}, 0.025)
      expect(normal.player.getTime()).toBeCloseTo(48.975)
    })

    it('starts the count again at the predicted wrap with "count in every repeat"', async () => {
      const { player, state } = await frameAt({ countInEveryRepeat: true }, 0.01, 1)

      expect(state()).toMatchObject({ phase: 'counting', count: { beat: 1, of: 4 } })
      expect(player.getTime()).toBe(23)
    })
  })

  it('wraps when the loop ends where the recording ends', async () => {
    const { player, run, state, elapse } = await setup({ countInBars: 0, durationSec: 81 })
    const last = evenTimeline.length - 1

    run((c) => c.setRange({ startPosition: last - 1, endPosition: last }))
    run((c) => c.playPause())
    expect(player.getTime()).toBe(evenTimeline[last - 1].startSec)
    elapse(4) // to the end of the 81 s recording, which is where bar 40 ends

    expect(state().phase).toBe('playing')
    expect(player.getTime()).toBe(evenTimeline[last - 1].startSec)
  })

  it('restart loop goes back to the count-in and the loop start', async () => {
    const { player, run, state, elapse } = await playingLoop()
    elapse(10)

    run((c) => c.restartLoop())

    expect(state()).toMatchObject({ phase: 'counting', count: { beat: 1, of: 4 } })
    expect(player.getTime()).toBe(23)
  })

  it('next loop moves the range on by its length and starts it', async () => {
    const { player, run, state } = await playingLoop()

    run((c) => c.nextLoop())

    expect(state().range).toEqual({ startPosition: 24, endPosition: 35 })
    expect(state()).toMatchObject({ phase: 'counting', looping: true })
    expect(player.getTime()).toBe(1 + 2 * 23) // bar 24, the pre-roll before bar 25
  })

  it('next loop at the end of the piece does nothing', async () => {
    const { run, state } = await setup({ memory: { loop: { startPosition: 30, endPosition: 39 } } })

    run((c) => c.nextLoop())

    expect(state()).toMatchObject({ phase: 'idle', range: { startPosition: 30, endPosition: 39 } })
  })
})

describe('usePractice: the metronome', () => {
  const METRONOME_ON = { on: true, volume: 0.8, tone: 'wood' as const }

  it('clicks once per beat, accented on the first beat of a bar', async () => {
    const { run, synth, elapse, runFrame } = await setup({ memory: { metronome: METRONOME_ON } })

    run((c) => c.playFrom(12)) // bar 13 starts at 25 s, a beat every 0.5 s
    runFrame()
    expect(synth.scheduled).toMatchObject([{ delaySec: 0, accent: true, tone: 'wood', volume: 0.8 }])

    elapse(0.4) // 25.4: the click at 25.5 is in the next 0.2 s
    expect(synth.scheduled).toHaveLength(2)
    expect(synth.scheduled[1].delaySec).toBeCloseTo(0.1)
    expect(synth.scheduled[1].accent).toBe(false)
    elapse(0.05)
    expect(synth.scheduled).toHaveLength(2) // each click once

    for (let i = 0; i < 16; i++) elapse(0.1) // on to 27.05: bar 14 has begun
    expect(synth.scheduled.map((click) => click.accent)).toEqual([true, false, false, false, true])
  })

  it('converts the click time to a wall delay by dividing by the speed', async () => {
    const { run, synth, elapse, runFrame } = await setup({ memory: { metronome: METRONOME_ON, speed: 0.75 } })

    run((c) => c.playFrom(12))
    runFrame()
    elapse(0.2)
    elapse(0.2)
    expect(synth.scheduled).toHaveLength(1)
    elapse(0.1) // 25.375: the click at 25.5 is 0.125 s of recording ahead
    expect(synth.scheduled).toHaveLength(2)
    expect(synth.scheduled[1].delaySec).toBeCloseTo(0.125 / 0.75)
  })

  it('does not click when it is off', async () => {
    const { run, synth, elapse, runFrame } = await setup()

    run((c) => c.playFrom(12))
    runFrame()
    for (let i = 0; i < 10; i++) elapse(0.1)

    expect(synth.scheduled).toEqual([])
  })

  it('cancels and reschedules after a seek', async () => {
    const { run, synth, elapse, runFrame } = await setup({ memory: { metronome: METRONOME_ON } })
    run((c) => c.playFrom(12))
    runFrame()
    elapse(0.4)
    expect(synth.scheduled).toHaveLength(2)
    const before = synth.cancelCalls

    run((c) => c.playFrom(20)) // bar 21 starts at 41 s

    expect(synth.cancelCalls).toBeGreaterThan(before)
    expect(synth.scheduled).toEqual([])
    runFrame()
    expect(synth.scheduled).toMatchObject([{ delaySec: 0, accent: true }])
  })

  it('cancels on pause and does not click while paused', async () => {
    const { run, synth, elapse, runFrame } = await setup({ memory: { metronome: METRONOME_ON } })
    run((c) => c.playFrom(12))
    runFrame()
    elapse(0.4)

    run((c) => c.playPause())
    runFrame()
    elapse(1)

    expect(synth.scheduled).toEqual([])
  })

  it('reschedules a pending click at the new wall delay when the speed changes', async () => {
    const { run, synth, elapse, runFrame } = await setup({ memory: { metronome: METRONOME_ON } })
    run((c) => c.playFrom(12))
    runFrame()
    elapse(0.4) // the click at 25.5 is scheduled, 0.1 s away

    run((c) => c.setSpeed(0.5))
    expect(synth.scheduled).toEqual([])
    runFrame()

    expect(synth.scheduled).toHaveLength(1)
    expect(synth.scheduled[0].delaySec).toBeCloseTo(0.2)
  })

  it('cancels when it is switched off, and clicks again when it is switched on', async () => {
    const { run, synth, elapse, runFrame } = await setup({ memory: { metronome: METRONOME_ON } })
    run((c) => c.playFrom(12))
    runFrame()
    elapse(0.4)

    run((c) => c.setMetronome({ on: false }))
    runFrame()
    expect(synth.scheduled).toEqual([])

    run((c) => c.setMetronome({ on: true, tone: 'beep' }))
    runFrame()
    expect(synth.scheduled).toMatchObject([{ delaySec: expect.closeTo(0.1) as unknown as number, tone: 'beep' }])
  })

  it('schedules nothing past the loop end, and clicks the loop start right after the wrap', async () => {
    const { run, synth, elapse, runFrame } = await setup({ countInBars: 0, memory: { metronome: METRONOME_ON, loop: LOOP_13_24 } })
    run((c) => c.playPause()) // at 25 s
    runFrame()
    elapse(23.7) // 48.7, the click at 48.5 is done with
    synth.scheduled = []
    elapse(0.2) // 48.9: the window reaches 49.1 but the loop ends at 49

    expect(synth.scheduled).toEqual([])

    elapse(0.25) // 49.15: the wrap
    expect(synth.scheduled).toMatchObject([{ delaySec: 0, accent: true }])
  })

  it('clicks during the pre-roll, following the recording', async () => {
    const { run, synth, runFrame } = await setup({ memory: { metronome: METRONOME_ON, loop: LOOP_13_24 } })

    run((c) => c.playPause())
    runFrame()

    expect(synth.scheduled).toMatchObject([{ delaySec: 0, accent: true }]) // the downbeat of bar 12
  })
})

describe('usePractice: the count-in fade', () => {
  const MID = Math.SQRT1_2 // the gain half way through a fade

  it('sets the player up for volume control inside the tap that starts the sound', async () => {
    const { player, run } = await setup({ memory: { loop: LOOP_13_24 } })
    const prepare = vi.spyOn(player, 'prepare')

    run((c) => c.playPause())

    expect(prepare).toHaveBeenCalled()
  })

  it('Off: the music stays at full level through a pre-roll', async () => {
    const { player, run, elapse } = await setup({ memory: { loop: LOOP_13_24 }, countInFade: 'off' })

    run((c) => c.playPause())
    expect(player.getFade()).toBe(1)
    elapse(1)
    expect(player.getFade()).toBe(1)
  })

  it('takes a fade changed while Practice is open at the next start of the loop', async () => {
    const { player, run, fade, rerender } = await setup({ memory: { loop: LOOP_13_24 }, countInFade: 'off' })

    fade.current = 'pre-roll'
    rerender()
    run((c) => c.playPause())

    expect(player.getFade()).toBe(0)
  })

  it('Pre-roll: starts silent, rises through the bar before the loop and is exactly full at the loop start', async () => {
    const { player, run, state, elapse } = await setup({ memory: { loop: LOOP_13_24 }, countInFade: 'pre-roll' })

    run((c) => c.playPause())
    expect(player.getTime()).toBe(23)
    expect(player.getFade()).toBe(0)
    elapse(1)
    expect(player.getFade()).toBeCloseTo(MID, 6)
    elapse(1)
    expect(state().phase).toBe('playing')
    expect(player.getFade()).toBe(1)
    elapse(0.5)
    expect(player.getFade()).toBe(1)
  })

  it('multiplies the music volume and never goes above it', async () => {
    const { player, run, elapse } = await setup({ memory: { loop: LOOP_13_24, musicVolume: 0.5 }, countInFade: 'pre-roll' })

    run((c) => c.playPause())
    expect(player.level).toBe(0)
    elapse(1)
    expect(player.level).toBeCloseTo(0.5 * MID, 6)
    run((c) => c.setMusicVolume(0.4)) // the toolbar slider, mid-fade
    expect(player.level).toBeCloseTo(0.4 * MID, 6)
    elapse(1)
    expect(player.level).toBeCloseTo(0.4, 10)
    expect(player.getVolume()).toBe(0.4)
  })

  it('follows the recorded beats at a slower speed too: full at the loop start', async () => {
    const { player, run, state, elapse } = await setup({ memory: { loop: LOOP_13_24, speed: 0.75 }, countInFade: 'pre-roll' })

    run((c) => c.playPause())
    elapse(1.3333) // 1 s of recording
    expect(player.getFade()).toBeCloseTo(MID, 3)
    elapse(1.4)
    expect(state().phase).toBe('playing')
    expect(player.getFade()).toBe(1)
  })

  it('pausing during the count puts the full volume back', async () => {
    const { player, run, elapse } = await setup({ memory: { loop: LOOP_13_24 }, countInFade: 'pre-roll' })

    run((c) => c.playPause())
    elapse(0.5)
    expect(player.getFade()).toBeLessThan(1)
    run((c) => c.playPause())

    expect(player.getFade()).toBe(1)
  })

  it('a seek during the count cancels the fade', async () => {
    const { player, run, elapse } = await setup({ memory: { loop: LOOP_13_24 }, countInFade: 'pre-roll' })

    run((c) => c.playPause())
    elapse(0.5)
    act(() => player.seek(60))

    expect(player.getFade()).toBe(1)
  })

  it('a new range during the count cancels the fade', async () => {
    const { player, run, elapse } = await setup({ memory: { loop: LOOP_13_24 }, countInFade: 'pre-roll' })

    run((c) => c.playPause())
    elapse(0.5)
    run((c) => c.setRange({ startPosition: 4, endPosition: 7 }))

    expect(player.getFade()).toBe(1)
  })

  it('fades again at the start of every count-in', async () => {
    const { player, run, elapse } = await setup({ memory: { loop: LOOP_13_24 }, countInFade: 'pre-roll' })
    run((c) => c.playPause())
    elapse(2.5)
    expect(player.getFade()).toBe(1)

    run((c) => c.restartLoop())

    expect(player.getFade()).toBe(0)
  })

  it('stopping the engine in a count restores the volume', async () => {
    const { player, run, elapse, unmount } = await setup({ memory: { loop: LOOP_13_24 }, countInFade: 'pre-roll' })
    run((c) => c.playPause())
    elapse(0.5)

    unmount()

    expect(player.getFade()).toBe(1)
  })

  describe('after a click count-in', () => {
    const clicks = { timeline: slowTwelveTimeline, marks: FERMATA_TWELVE, memory: { loop: LOOP_13_24 } }

    it('Pre-roll: a click count-in does not fade', async () => {
      const { player, run, state, elapse } = await setup({ ...clicks, countInFade: 'pre-roll' })

      run((c) => c.playPause())
      elapse(2.1)

      expect(state().phase).toBe('playing')
      expect(player.getFade()).toBe(1)
    })

    it('Pre-roll and loop start: the loop fades in over its first beat', async () => {
      const { player, run, state, elapse } = await setup({ ...clicks, countInFade: 'pre-roll-and-loop' })

      run((c) => c.playPause())
      expect(player.getFade()).toBe(0)
      elapse(2.05) // the clicks end and the loop starts to play
      expect(state().phase).toBe('playing')
      expect(player.getFade()).toBe(0)
      elapse(0.25) // half of the 0.5 s beat
      expect(player.getFade()).toBeCloseTo(MID, 6)
      elapse(0.3)
      expect(player.getFade()).toBe(1)
    })

    it('Under the clicks: plays the recording before the loop under the clicks, arriving on the last click', async () => {
      const { player, run, state, elapse } = await setup({ ...clicks, countInFade: 'under-clicks' })

      run((c) => c.playPause())
      expect(state()).toMatchObject({ phase: 'counting', count: { beat: 1, of: 4 } })
      expect(player.isPlaying()).toBe(true)
      expect(player.getTime()).toBe(25) // 2 s of clicks before the loop start at 27 s
      expect(player.getFade()).toBe(0)
      elapse(1)
      expect(player.getTime()).toBeCloseTo(26, 5)
      expect(player.getFade()).toBeCloseTo(MID, 6)
      expect(state().count).toEqual({ beat: 3, of: 4 })
      elapse(1.01)
      expect(state()).toMatchObject({ phase: 'playing', count: null })
      expect(player.getFade()).toBe(1)
      expect(player.getTime()).toBeCloseTo(27, 1)
    })

    it('Under the clicks at 0.75x: the recording covers the clicks\' wall time times the speed', async () => {
      const { player, run, state, elapse } = await setup({ ...clicks, memory: { loop: LOOP_13_24, speed: 0.75 }, countInFade: 'under-clicks' })

      run((c) => c.playPause())
      expect(player.getTime()).toBeCloseTo(25, 6) // 2.667 s of clicks x 0.75 = 2 s of recording
      elapse(2.7)
      expect(state().phase).toBe('playing')
      expect(player.getFade()).toBe(1)
    })

    it('Under the clicks: the cursor follows the recording, and the count still counts', async () => {
      const { run, state, elapse } = await setup({ ...clicks, countInFade: 'under-clicks' })

      run((c) => c.playPause())
      elapse(0.5)

      expect(state().timeSec).toBeCloseTo(25.5, 5)
      expect(state().count).toEqual({ beat: 2, of: 4 })
    })

    it('Under the clicks: the metronome does not click along with the count', async () => {
      const { run, synth, elapse } = await setup({ ...clicks, memory: { loop: LOOP_13_24, metronome: { on: true, volume: 0.5, tone: 'wood' } }, countInFade: 'under-clicks' })

      run((c) => c.playPause())
      elapse(1)

      expect(synth.scheduled).toHaveLength(4) // the four counts
    })

    it('Under the clicks with the loop at bar 1: clicks only', async () => {
      const { player, run, state } = await setup({ memory: { loop: { startPosition: 0, endPosition: 3 } }, countInFade: 'under-clicks' })

      run((c) => c.playPause())

      expect(state().phase).toBe('counting')
      expect(player.isPlaying()).toBe(false)
      expect(player.getFade()).toBe(1)
    })

    it('Under the clicks near the recording start: waits out the rest of the clicks so the loop start lands on time', async () => {
      const { player, run, state, elapse } = await setup({
        countInBars: 2,
        memory: { loop: { startPosition: 1, endPosition: 4 } },
        countInFade: 'under-clicks',
      })

      run((c) => c.playPause()) // 4 s of clicks; the loop starts at 3 s: the recording waits 1 s, then plays from 0
      expect(player.getTime()).toBe(0)
      expect(player.isPlaying()).toBe(false)
      elapse(1.01)
      expect(player.isPlaying()).toBe(true)
      elapse(3)
      expect(state().phase).toBe('playing')
      expect(player.getTime()).toBeCloseTo(3.01, 1)
      expect(player.getFade()).toBe(1)
    })

    it('Under the clicks: pausing stops the recording and restores the volume', async () => {
      const { player, run, state, elapse } = await setup({ ...clicks, countInFade: 'under-clicks' })
      run((c) => c.playPause())
      elapse(0.5)

      run((c) => c.playPause())

      expect(state().phase).toBe('paused')
      expect(player.isPlaying()).toBe(false)
      expect(player.getFade()).toBe(1)
    })

    it('Under the clicks: a pause while the recording is still waiting never starts it', async () => {
      const { player, run, elapse } = await setup({
        countInBars: 2,
        memory: { loop: { startPosition: 1, endPosition: 4 } },
        countInFade: 'under-clicks',
      })
      run((c) => c.playPause())
      run((c) => c.playPause())

      elapse(5)

      expect(player.isPlaying()).toBe(false)
    })
  })
})

describe('usePractice: the count-in on every Play (Erez, 2026-11-03)', () => {
  it('counts in before playing with no loop, from the start of the bar at the playhead', async () => {
    const { run, state, player, elapse } = await setup({ countInBars: 1 })
    act(() => player.seek(10)) // inside bar 5, which starts at 9 s

    run((c) => c.playPause())
    expect(state()).toMatchObject({ phase: 'counting', looping: false })

    elapse(3)
    expect(state().phase).toBe('playing')
    expect(player.getTime()).toBeGreaterThanOrEqual(9)
  })

  it('counts in again after a pause', async () => {
    const { run, state, elapse } = await setup({ countInBars: 1 })
    run((c) => c.playPause())
    elapse(3)
    run((c) => c.playPause())
    expect(state().phase).toBe('paused')

    run((c) => c.playPause())
    expect(state().phase).toBe('counting')
  })

  it('says which bar it counts into: the bar at the playhead, then nothing once the music plays', async () => {
    const { run, state, player, elapse } = await setup({ countInBars: 1 })
    act(() => player.seek(10)) // inside bar 5 (position 4)

    run((c) => c.playPause())
    expect(state().countAt).toBe(4)

    elapse(3)
    expect(state().countAt).toBeNull()
  })

  it('plays at once when the count-in is off', async () => {
    const { run, state, synth } = await setup({ countInBars: 0 })
    run((c) => c.playPause())
    expect(state().phase).toBe('playing')
    expect(synth.scheduled).toHaveLength(0)
  })
})

describe('usePractice: selecting a bar (Erez, 2026-11-04)', () => {
  it('moves the playhead to the bar and starts nothing', async () => {
    const { run, state, player } = await setup({ countInBars: 1 })

    run((c) => c.selectBar(12))

    expect(player.getTime()).toBeCloseTo(25)
    expect(player.isPlaying()).toBe(false)
    expect(state().phase).toBe('paused')
  })

  it('lets Play count in from the selected bar', async () => {
    const { run, state, elapse } = await setup({ countInBars: 1 })
    run((c) => c.selectBar(12))

    run((c) => c.playPause())
    expect(state().phase).toBe('counting')

    elapse(3)
    expect(state().phase).toBe('playing')
  })

  it('jumps while playing and keeps playing', async () => {
    const { run, state, player, elapse } = await setup({ countInBars: 0 })
    run((c) => c.playPause())
    elapse(0.1)

    run((c) => c.selectBar(12))

    expect(state().phase).toBe('playing')
    expect(player.getTime()).toBeCloseTo(25, 0)
  })

  it('stops a count-in without playing', async () => {
    const { run, state, player } = await setup({ countInBars: 1 })
    act(() => player.seek(10))
    run((c) => c.playPause())
    expect(state().phase).toBe('counting')

    run((c) => c.selectBar(20))

    expect(state().phase).toBe('paused')
    expect(player.isPlaying()).toBe(false)
  })
})
