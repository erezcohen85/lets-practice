import { createFakePlayer } from '@/lib/fakes/fakePlayer'
import { type PlayerEvent } from '@/lib/player/player'

function setup(durationSec = 100) {
  const player = createFakePlayer(durationSec)
  const events: PlayerEvent[] = []
  player.onChange((event) => events.push(event))
  return { player, events }
}

describe('createFakePlayer', () => {
  it('knows no duration and plays nothing before a load', async () => {
    const { player } = setup()

    expect(player.getDuration()).toBeNull()
    expect(player.loadedUrl).toBeNull()
    expect(player.isPlaying()).toBe(false)
    await expect(player.play()).rejects.toThrow()
  })

  it('loads at once and gives its duration', async () => {
    const { player, events } = setup(100)

    await player.load('blob:a')

    expect(player.loadedUrl).toBe('blob:a')
    expect(player.getDuration()).toBe(100)
    expect(events).toEqual(['loaded'])
  })

  it("rejects a url that starts with 'fail:'", async () => {
    const { player, events } = setup()

    await expect(player.load('fail:no')).rejects.toThrow('could not load the recording')

    expect(player.loadedUrl).toBeNull()
    expect(events).toEqual(['error'])
  })

  it('moves time only by advance(), and only while playing', async () => {
    const { player, events } = setup()
    await player.load('blob:a')

    player.advance(5)
    expect(player.getTime()).toBe(0)
    await player.play()
    expect(player.isPlaying()).toBe(true)
    player.advance(5)
    expect(player.getTime()).toBe(5)
    player.pause()
    player.advance(5)

    expect(player.getTime()).toBe(5)
    expect(events).toEqual(['loaded', 'play', 'pause'])
  })

  it('moves recording time by the rate', async () => {
    const { player, events } = setup()
    await player.load('blob:a')
    player.setRate(2)
    await player.play()

    player.advance(5)

    expect(player.getTime()).toBe(10)
    expect(events).toContain('rate')
  })

  it('takes a rate between the old steps and refuses one outside 0.25 to 2', async () => {
    const { player } = setup()
    await player.load('blob:a')
    player.setRate(0.85)
    await player.play()
    player.advance(10)

    expect(player.getTime()).toBeCloseTo(8.5)
    for (const rate of [3, 0.2, 0, Number.NaN]) expect(() => player.setRate(rate)).toThrow(RangeError)
  })

  it('clamps a seek to 0..duration and tells the listeners', async () => {
    const { player, events } = setup(100)
    await player.load('blob:a')

    player.seek(-3)
    expect(player.getTime()).toBe(0)
    player.seek(250)
    expect(player.getTime()).toBe(100)
    player.seek(12)

    expect(player.getTime()).toBe(12)
    expect(events.filter((event) => event === 'seek')).toHaveLength(3)
  })

  it('stops at the end with pause and ended', async () => {
    const { player, events } = setup(10)
    await player.load('blob:a')
    await player.play()

    player.advance(30)

    expect(player.getTime()).toBe(10)
    expect(player.isPlaying()).toBe(false)
    expect(events).toEqual(['loaded', 'play', 'pause', 'ended'])
  })

  it('starts again from the beginning when played at the end', async () => {
    const { player } = setup(10)
    await player.load('blob:a')
    player.seek(10)

    await player.play()
    player.advance(2)

    expect(player.getTime()).toBe(2)
  })

  it('goes back to the start on a new load', async () => {
    const { player } = setup(10)
    await player.load('blob:a')
    player.seek(7)

    await player.load('blob:b')

    expect(player.getTime()).toBe(0)
    expect(player.loadedUrl).toBe('blob:b')
  })

  it('stops telling an unsubscribed listener, and everyone after destroy', async () => {
    const player = createFakePlayer()
    const first: PlayerEvent[] = []
    const second: PlayerEvent[] = []
    const stop = player.onChange((event) => first.push(event))
    player.onChange((event) => second.push(event))

    await player.load('blob:a')
    stop()
    await player.play()
    player.destroy()
    player.pause()

    expect(first).toEqual(['loaded'])
    expect(second).toEqual(['loaded', 'play'])
    expect(player.isPlaying()).toBe(false)
  })

  it('keeps a volume from 0 to 1', () => {
    const { player } = setup()

    expect(player.getVolume()).toBe(1)
    player.setVolume(0.25)
    expect(player.getVolume()).toBe(0.25)
    player.setVolume(2)
    expect(player.getVolume()).toBe(1)
    player.setVolume(-2)
    expect(player.getVolume()).toBe(0)
  })

  it('treats a volume that is not a number as 0', () => {
    const { player } = setup()

    player.setVolume(Number.NaN)
    expect(player.getVolume()).toBe(0)
  })

  it('keeps a fade from 0 to 1, starting at 1, and reads one that is not a number as 1', () => {
    const { player } = setup()

    expect(player.getFade()).toBe(1)
    player.setFade(0.3)
    expect(player.getFade()).toBe(0.3)
    player.setFade(2)
    expect(player.getFade()).toBe(1)
    player.setFade(-1)
    expect(player.getFade()).toBe(0)
    player.setFade(Number.NaN)
    expect(player.getFade()).toBe(1)
  })

  it('has a level that is the volume times the fade, never above the volume', () => {
    const { player } = setup()

    player.setVolume(0.6)
    player.setFade(0.5)

    expect(player.level).toBeCloseTo(0.3, 10)
    expect(player.getVolume()).toBe(0.6)
  })
})
