import { createFakeClickSynth } from '@/lib/audio/fakeClickSynth'

describe('createFakeClickSynth', () => {
  it('records each click with the tone and volume at the time it was scheduled', () => {
    const synth = createFakeClickSynth()
    synth.schedule(0.5, true)
    synth.setTone('beep')
    synth.setVolume(0.25)
    synth.schedule(1, false)
    expect(synth.scheduled).toEqual([
      { delaySec: 0.5, accent: true, tone: 'wood', volume: 0.8 },
      { delaySec: 1, accent: false, tone: 'beep', volume: 0.25 },
    ])
  })

  it('cancelAll empties the list, and volume 0 records nothing', async () => {
    const synth = createFakeClickSynth()
    synth.schedule(0, false)
    synth.cancelAll()
    expect(synth.scheduled).toEqual([])
    synth.setVolume(0)
    synth.schedule(0, false)
    expect(synth.scheduled).toEqual([])
    await expect(synth.resume()).resolves.toBeUndefined()
    synth.destroy()
  })
})
