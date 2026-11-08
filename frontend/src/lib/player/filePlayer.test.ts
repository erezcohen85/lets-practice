import { SPEED_RANGE } from '@/domain/tempo'
import { createFilePlayer } from '@/lib/player/filePlayer'
import { type PlayerEvent } from '@/lib/player/player'

/** The parts of an HTMLAudioElement the file player uses; it counts listeners so a test can see them removed. */
class StubAudio extends EventTarget {
  currentTime = 0
  duration = NaN
  playbackRate = 1
  volume = 1
  preservesPitch = false
  preload = ''
  autoplay = false
  paused = true
  ended = false
  src = ''
  loads = 0
  listenerCount = 0

  play = vi.fn(async () => {
    this.paused = false
    this.fire('play')
  })
  pause = vi.fn(() => {
    if (this.paused) return
    this.paused = true
    this.fire('pause')
  })

  load() {
    this.loads += 1
  }

  override addEventListener(...args: Parameters<EventTarget['addEventListener']>) {
    this.listenerCount += 1
    super.addEventListener(...args)
  }

  override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>) {
    this.listenerCount -= 1
    super.removeEventListener(...args)
  }

  fire(type: string) {
    this.dispatchEvent(new Event(type))
  }
}

/** An element like iPad Safari's: the volume reads 1 and ignores what is set. */
class IgnoresVolumeAudio extends StubAudio {
  crossOrigin: string | null = null

  constructor() {
    super()
    // An own accessor, since the base class makes `volume` a plain field of the instance.
    Object.defineProperty(this, 'volume', { get: () => 1, set: () => {} })
  }
}

/** The parts of Web Audio the player uses: what it connected, and the gain it was left at. */
function stubWebAudio(options: { failToRoute?: boolean } = {}) {
  const made = {
    contexts: 0,
    sources: [] as unknown[],
    closed: false,
    resumed: 0,
    state: 'suspended' as 'suspended' | 'running',
    gain: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
    destination: { id: 'destination' },
  }
  const context = {
    destination: made.destination,
    get state() {
      return made.state
    },
    createMediaElementSource(element: unknown) {
      if (options.failToRoute) throw new Error('already connected')
      made.sources.push(element)
      return { connect: vi.fn(() => made.gain), disconnect: vi.fn() }
    },
    createGain: () => made.gain,
    resume: vi.fn(async () => {
      made.resumed += 1
      made.state = 'running'
    }),
    close: vi.fn(async () => {
      made.closed = true
    }),
  }
  return { made, createContext: () => { made.contexts += 1; return context as unknown as AudioContext } }
}

function setup() {
  const audio = new StubAudio()
  const player = createFilePlayer(audio as unknown as HTMLAudioElement)
  const events: PlayerEvent[] = []
  player.onChange((event) => events.push(event))
  return { audio, player, events }
}

/** Starts a load and makes the stub able to play it. */
async function loaded(duration = 120) {
  const made = setup()
  const loading = made.player.load('blob:recording')
  made.audio.duration = duration
  made.audio.fire('loadedmetadata')
  made.audio.fire('canplay')
  await loading
  return made
}

describe('createFilePlayer', () => {
  it('sets the element up: preload auto, pitch preserved, no autoplay', () => {
    const { audio } = setup()

    expect(audio.preload).toBe('auto')
    expect(audio.preservesPitch).toBe(true)
    expect(audio.autoplay).toBe(false)
  })

  it('offers the speed range', () => {
    expect(setup().player.getRateRange()).toEqual(SPEED_RANGE)
  })

  it('sets the element volume, clamped to 0..1, and reports it', () => {
    const { audio, player } = setup()

    expect(player.getVolume()).toBe(1)
    player.setVolume(0.4)
    expect(audio.volume).toBe(0.4)
    expect(player.getVolume()).toBe(0.4)
    player.setVolume(3)
    expect(audio.volume).toBe(1)
    player.setVolume(-1)
    expect(audio.volume).toBe(0)
    expect(player.getVolume()).toBe(0)
  })

  it('treats a volume that is not a number as 0', () => {
    const { audio, player } = setup()

    player.setVolume(Number.NaN)
    expect(audio.volume).toBe(0)
    expect(player.getVolume()).toBe(0)
  })

  describe('the fade', () => {
    it('starts at 1 and multiplies the volume: the element gets volume x fade', () => {
      const { audio, player } = setup()

      expect(player.getFade()).toBe(1)
      player.setVolume(0.8)
      player.setFade(0.5)

      expect(audio.volume).toBeCloseTo(0.4, 10)
      expect(player.getVolume()).toBe(0.8)
      expect(player.getFade()).toBe(0.5)
    })

    it('changing the volume in the middle of a fade keeps the fade', () => {
      const { audio, player } = setup()
      player.setFade(0.5)

      player.setVolume(0.6)

      expect(audio.volume).toBeCloseTo(0.3, 10)
    })

    it('clamps to 0..1 and reads a bad number as 1, never silence', () => {
      const { audio, player } = setup()

      player.setFade(4)
      expect(audio.volume).toBe(1)
      player.setFade(-4)
      expect(audio.volume).toBe(0)
      player.setFade(Number.NaN)
      expect(audio.volume).toBe(1)
      expect(player.getFade()).toBe(1)
    })

    it('a device that honours the volume gets no Web Audio', () => {
      const web = stubWebAudio()
      const audio = new StubAudio()
      const player = createFilePlayer(audio as unknown as HTMLAudioElement, web.createContext)

      player.prepare()

      expect(web.made.contexts).toBe(0)
      expect((audio as { crossOrigin?: string }).crossOrigin).toBeUndefined()
    })
  })

  describe('on a device that ignores the element volume', () => {
    function iPad(options: { failToRoute?: boolean } = {}) {
      const web = stubWebAudio(options)
      const audio = new IgnoresVolumeAudio()
      const player = createFilePlayer(audio as unknown as HTMLAudioElement, web.createContext)
      return { ...web, audio, player }
    }

    it('asks for the file with CORS from the start, because a routed element is silent without it', () => {
      expect(iPad().audio.crossOrigin).toBe('anonymous')
    })

    it('makes no context until prepare, then routes the element through one gain, once', () => {
      const { made, audio, player } = iPad()
      expect(made.contexts).toBe(0)

      player.prepare()
      player.prepare()

      expect(made.contexts).toBe(1)
      expect(made.sources).toEqual([audio])
    })

    it('puts volume x fade on the gain, and leaves the element volume alone', () => {
      const { made, player } = iPad()
      player.prepare()

      player.setVolume(0.8)
      player.setFade(0.5)

      expect(made.gain.gain.value).toBeCloseTo(0.4, 10)
      expect(player.getVolume()).toBe(0.8)
    })

    it('a volume and a fade set before prepare are on the gain once it exists', () => {
      const { made, player } = iPad()
      player.setVolume(0.5)
      player.setFade(0.5)

      player.prepare()

      expect(made.gain.gain.value).toBeCloseTo(0.25, 10)
    })

    it('resumes a suspended context when it plays', async () => {
      const { made, player } = iPad()
      player.prepare()
      made.state = 'suspended'
      const before = made.resumed

      await player.play()

      expect(made.resumed).toBe(before + 1)
    })

    it('closes the context when it is destroyed', () => {
      const { made, player } = iPad()
      player.prepare()

      player.destroy()

      expect(made.closed).toBe(true)
    })

    it('plays on, without volume control, when the element cannot be routed', async () => {
      const { made, player, audio } = iPad({ failToRoute: true })

      expect(() => player.prepare()).not.toThrow()
      player.setFade(0.2)
      await player.play()

      expect(made.gain.gain.value).toBe(1)
      expect(audio.play).toHaveBeenCalled()
    })
  })

  describe('load', () => {
    it('gives the element the url and resolves when it can play', async () => {
      const { audio, player, events } = setup()
      let done = false
      const loading = player.load('blob:recording').then(() => {
        done = true
      })

      expect(audio.src).toBe('blob:recording')
      expect(audio.loads).toBe(1)
      audio.duration = 120
      audio.fire('loadedmetadata')
      await Promise.resolve()
      expect(done).toBe(false)
      audio.fire('canplay')
      await loading

      expect(done).toBe(true)
      expect(events).toEqual(['loaded'])
      expect(player.getDuration()).toBe(120)
      expect(audio.play).not.toHaveBeenCalled()
    })

    it('rejects with the load error when the element reports an error', async () => {
      const { audio, player, events } = setup()
      const loading = player.load('blob:broken')

      audio.fire('error')

      await expect(loading).rejects.toThrow('could not load the recording')
      expect(events).toEqual(['error'])
    })

    it('reports an error that comes after loading too', async () => {
      const { audio, events } = await loaded()

      audio.fire('error')

      expect(events).toEqual(['loaded', 'error'])
    })

    it('does not reject an earlier load that is replaced by a later one', async () => {
      const { audio, player } = setup()
      const first = player.load('blob:one')
      const second = player.load('blob:two')

      audio.duration = 30
      audio.fire('canplay')

      await expect(first).resolves.toBeUndefined()
      await expect(second).resolves.toBeUndefined()
      expect(audio.src).toBe('blob:two')
    })
  })

  describe('duration', () => {
    it('is null before the element knows it, and for an endless stream', () => {
      const { audio, player } = setup()

      expect(player.getDuration()).toBeNull()
      audio.duration = Infinity
      expect(player.getDuration()).toBeNull()
    })
  })

  describe('play and pause', () => {
    it('plays and pauses the element and tells the listeners', async () => {
      const { audio, player, events } = await loaded()

      await player.play()
      expect(player.isPlaying()).toBe(true)
      player.pause()
      expect(player.isPlaying()).toBe(false)

      expect(events).toEqual(['loaded', 'play', 'pause'])
      expect(audio.pause).toHaveBeenCalled()
    })

    it('reports the end of the recording', async () => {
      const { audio, events } = await loaded()

      audio.paused = true
      audio.fire('pause')
      audio.ended = true
      audio.fire('ended')

      expect(events).toEqual(['loaded', 'pause', 'ended'])
    })

    it('does not count an ended element as playing', async () => {
      const { audio, player } = await loaded()
      audio.paused = false
      audio.ended = true

      expect(player.isPlaying()).toBe(false)
    })

    it('passes on a play that the browser refuses', async () => {
      const { audio, player } = await loaded()
      audio.play.mockRejectedValueOnce(new Error('not allowed'))

      await expect(player.play()).rejects.toThrow('not allowed')
    })
  })

  describe('seek', () => {
    it('sets the element time', async () => {
      const { audio, player } = await loaded(120)

      player.seek(42.5)

      expect(audio.currentTime).toBe(42.5)
      expect(player.getTime()).toBe(42.5)
    })

    it('clamps to 0..duration', async () => {
      const { audio, player } = await loaded(120)

      player.seek(-5)
      expect(audio.currentTime).toBe(0)
      player.seek(500)
      expect(audio.currentTime).toBe(120)
    })

    it('clamps below zero only while the duration is not known', () => {
      const { audio, player } = setup()

      player.seek(-1)
      expect(audio.currentTime).toBe(0)
      player.seek(10)
      expect(audio.currentTime).toBe(10)
    })

    it('tells the listeners when the element has sought', async () => {
      const { audio, events } = await loaded()

      audio.fire('seeked')

      expect(events).toEqual(['loaded', 'seek'])
    })
  })

  describe('rate', () => {
    it('sets the playback rate and keeps the pitch', async () => {
      const { audio, player, events } = await loaded()

      player.setRate(0.75)
      audio.fire('ratechange')

      expect(audio.playbackRate).toBe(0.75)
      expect(audio.preservesPitch).toBe(true)
      expect(events).toEqual(['loaded', 'rate'])
    })

    it('takes a rate between the old steps, as the speed slider gives', async () => {
      const { audio, player } = await loaded()

      player.setRate(0.85)

      expect(audio.playbackRate).toBe(0.85)
    })

    it('takes both ends of the range and refuses a rate outside it or not a number', () => {
      const { audio, player } = setup()

      player.setRate(0.25)
      expect(audio.playbackRate).toBe(0.25)
      player.setRate(2)
      expect(audio.playbackRate).toBe(2)
      for (const rate of [0.2, 2.05, 0, -1, Number.NaN]) expect(() => player.setRate(rate)).toThrow(RangeError)
      expect(audio.playbackRate).toBe(2)
    })
  })

  describe('onChange', () => {
    it('stops telling a listener that has unsubscribed', async () => {
      const { audio, player } = setup()
      const heard: PlayerEvent[] = []
      const stop = player.onChange((event) => heard.push(event))

      audio.fire('play')
      stop()
      audio.fire('pause')

      expect(heard).toEqual(['play'])
    })
  })

  describe('destroy', () => {
    it('pauses and removes every listener it added', () => {
      const { audio, player, events } = setup()
      expect(audio.listenerCount).toBeGreaterThan(0)

      player.destroy()

      expect(audio.listenerCount).toBe(0)
      expect(audio.pause).toHaveBeenCalled()
      audio.fire('play')
      expect(events).toEqual([])
    })

    it('removes the listeners of a load that is still waiting', async () => {
      const { audio, player } = setup()
      const loading = player.load('blob:recording').catch((error: unknown) => error)

      player.destroy()

      expect(audio.listenerCount).toBe(0)
      expect(await loading).toBeInstanceOf(Error)
    })
  })
})
