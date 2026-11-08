import { afterEach, describe, expect, it, vi } from 'vitest'
import { readAudioSeconds } from '@/lib/audioDuration'

// jsdom has no media: the Audio element and the object URLs are stood in for, so the metadata can arrive (or not) when the test says.
class FakeAudio extends EventTarget {
  static last: FakeAudio
  duration = Number.NaN
  preload = ''
  src = ''
  constructor() {
    super()
    FakeAudio.last = this
  }
  removeAttribute() {}
}

const file = new File(['x'], 'take.mp3', { type: 'audio/mpeg' })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubMedia(createObjectURL: () => string = () => 'blob:take') {
  const revoke = vi.fn()
  vi.stubGlobal('Audio', FakeAudio)
  vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke)
  return revoke
}

describe('readAudioSeconds', () => {
  it('gives the duration from the metadata and revokes the object URL', async () => {
    const revoke = stubMedia()
    const pending = readAudioSeconds(file)
    FakeAudio.last.duration = 185.5
    FakeAudio.last.dispatchEvent(new Event('loadedmetadata'))
    expect(await pending).toBe(185.5)
    expect(revoke).toHaveBeenCalledWith('blob:take')
  })

  it('is null when the file cannot be read', async () => {
    stubMedia()
    const pending = readAudioSeconds(file)
    FakeAudio.last.dispatchEvent(new Event('error'))
    expect(await pending).toBeNull()
  })

  it('is null for a duration that is not a finite length (a stream)', async () => {
    stubMedia()
    const pending = readAudioSeconds(file)
    FakeAudio.last.duration = Number.POSITIVE_INFINITY
    FakeAudio.last.dispatchEvent(new Event('loadedmetadata'))
    expect(await pending).toBeNull()
  })

  it('is null when no object URL can be made', async () => {
    stubMedia(() => {
      throw new Error('no object URLs')
    })
    expect(await readAudioSeconds(file)).toBeNull()
  })

  it('gives up when the metadata never comes', async () => {
    vi.useFakeTimers()
    stubMedia()
    const pending = readAudioSeconds(file)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toBeNull()
  })
})
